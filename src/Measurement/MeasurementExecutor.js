import InViewTimer from '../Timing/InViewTimer';
import { defaultStrategy } from './Strategies/';
import { validTactic, validateStrategy } from '../Helpers/Validators';
import * as Environment from '../Environment/Environment';
import * as Events from './Events';

// Responsible for collecting measurement strategy,
// watching for measurement changes,
// tracking how long an element is viewable for,
// and notifying listeners of changes
export default class MeasurementExecutor {
  constructor(element, strategy = {}) {
    this.timers = {};
    this._listeners = { start: [], stop: [], change: [], complete: [], unmeasureable: [] };
    this.element = element;
    this.strategy = Object.assign({}, defaultStrategy, strategy);

    const validated = validateStrategy(this.strategy);

    if(validated.invalid) {
      throw validated.reasons;
    }

    this.tactic = this._selectTactic(this.strategy.tactics);
    
    if(this.tactic) {
      this._addSubscriptions(this.tactic);
    }   

    if(this.unmeasureable) {
      // fire unmeasureable after current JS loop completes 
      // so opportunity is given for consumers to provide unmeasureable callback
      setTimeout( () => this._publish(Events.UNMEASUREABLE, Environment.getDetails(this.element)), 0);
    }
    else if(this.strategy.autostart) {
      this.tactic.start();
    }
  }

  start() {
    this.tactic.start();
  }

  onViewableStart(callback) {
    return this._addCallback(callback, Events.START);
  }

  onViewableStop(callback) {
    return this._addCallback(callback, Events.STOP);
  }

  onViewableChange(callback) {
    return this._addCallback(callback, Events.CHANGE);
  }

  onViewableComplete(callback) {
    return this._addCallback(callback, Events.COMPLETE);
  }

  onUnmeasureable(callback) {
    return this._addCallback(callback, Events.UNMEASUREABLE);
  }

  get unmeasureable() {
    return !this.tactic || this.tactic.unmeasureable;
  }

  // select first tactic that is not unmeasureable
  _selectTactic(tactics) {
    return tactics
            .filter(validTactic)
            .map(this._instantiateTactic.bind(this))
            .find(tactic => !tactic.unmeasureable);
  }

  _instantiateTactic(tactic) {
    return new tactic(element, this.strategy.criteria);
  }

  _addSubscriptions(tactic) {
    if(tactic) {
      tactic.onInView(this._tacticChange.bind(this, Events.INVIEW, tactic));
      tactic.onChangeView(this._tacticChange.bind(this, Events.CHANGE, tactic));
      tactic.onOutView(this._tacticChange.bind(this, Events.OUTVIEW, tactic));
    }
  }

  _tacticChange(change, tactic) {
    let eventName;
    const details = this._appendEnvironment(tactic);

    switch(change) {
      case Events.INVIEW:
        this.timer = new InViewTimer(this.strategy.criteria.timeInView);
        this.timer.elapsed(this._timerElapsed.bind(this, tactic));
        this.timer.start();
        eventName = Events.START;
        break;

      case Events.CHANGE:
        eventName = Events.CHANGE;
        break;

      case Events.OUTVIEW:
        if(this.timer) {
          this.timer.stop();
          delete this.timer;
        }
        eventName = Events.STOP;
        break;
    }

    this._publish(eventName, details);
  }

  _publish(event, value) {
    if(Array.isArray(this._listeners[event])) {
      this._listeners[event].forEach( l => l(value) );
    }
  }

  _timerElapsed(tactic) {
    this._publish(Events.COMPLETE, tactic);
  }

  _addCallback(callback, event) {
    if(this._listeners[event] && typeof callback === 'function') {
      this._listeners[event].push(callback);
    }
    else if(typeof callback !== 'function') {
      throw 'Callback must be a function';
    }

    return this;
  }

  _appendEnvironment(tactic) {
    return Object.assign({}, { percentViewable: tactic.percentViewable }, Environment.getDetails(this.element) );
  }
}
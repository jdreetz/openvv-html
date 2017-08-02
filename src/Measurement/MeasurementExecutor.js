import InViewTimer from '../Timing/InViewTimer';
import { defaultStrategy } from './Strategies/';
import { validTactic } from '../Helpers/';
import * as Environment from '../Environment/Environment';

// Responsible for collecting measurement strategy,
// watching for measurement changes,
// tracking how long an element is viewable for,
// and notifying listeners of changes
export default class MeasurementExecutor {
  constructor(element, strategy = {}) {
    this.timers = {};
    this.listeners = { start: [], stop: [], change: [], complete: [], unmeasureable: [] };
    this.element = element;
    this.strategy = Object.assign({}, defaultStrategy, strategy); 
    this.tactic = this.selectTactic(this.strategy.tactics);
    
    if(this.tactic) {
      this.addListeners(this.tactic);
    }   

    if(this.unmeasureable) {
      // fire unmeasureable after current JS loop completes 
      // so opportunity is given for consumers to provide unmeasureable callback
      setTimeout( () => this.listeners.unmeasureable.forEach( m => m() ), 0);
    }
    else if(this.startegy.autostart) {
      this.tactic.start();
    }
  }

  // select first tactic that is not unmeasureable
  selectTactic(tactics) {
    return tactics
            .filter(validTactic)
            .map(this.instantiateTactic.bind(this))
            .find(tactic => !tactic.unmeasureable);
  }

  instantiateTactic(tactic) {
    return instance = new tactic(element, this.strategy.criteria);
  }

  addListeners(tactic) {
    if(tactic) {
      tactic.onInView(this.tacticChange.bind(this,'inview',tactic));
      tactic.onChangeView(this.tacticChange.bind(this,'change',tactic));
      tactic.onOutView(this.tacticChange.bind(this,'outview',tactic));
    }
  }

  tacticChange(change, tactic) {
    const details = this.appendEnvironment(this.tactic);

    switch(change) {
      case 'inview':
        this.timer = new InViewTimer(this.strategy.criteria.timeInView);
        timer.elapsed(this.timerElasped.bind(this, tactic));
        timer.start();
        this.listeners.start.forEach( l => l(details);
        break;

      case 'change':
        this.listeners.change.forEach( l => l(details);
        break;

      case 'outview':
        if(this.timer) {
          this.timer.stop();
          delete this.timer;
        }
        this.listeners.stop.forEach( l => l(details);
        break;
    }
  }

  timerElapsed(tactic) {
    this.listeners.complete.forEach( l => l(tactic) );
  }

  addCallback(callback, event) {
    if(this.listeners[event] && typeof callback === 'function') {
      this.listeners[event].push(callback);
    }
    else if(typeof callback !== 'function') {
      throw 'Callback must be a function';
    }

    return this;
  }

  get unmeasureable() {
    return !this.tactic || this.tactic.unmeasureable;
  }

  start() {
    this.tactic.start();
  }

  appendEnvironment(tactic) {
    return Object.assign({}, { percentViewable: tactic.percentViewable }, Environment.getDetails() );
  }

  // Main event dispatchers
  onViewableStart(callback) {
    return this.addCallback(callback, 'start');
  }

  onViewableStop(callback) {
    return this.addCallback(callback), 'stop');
  }

  onViewableChange(callback) {
    return this.addCallback(callback, 'change');
  }

  onViewableComplete(callback) {
    return this.addCallback(callback, 'complete');
  }

  onUnmeasureable(callback) {
    return this.addCallback(callback,'unmeasureable');
  }
}
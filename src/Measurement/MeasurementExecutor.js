import InViewTimer from '../Timing/InViewTimer';
import { defaultStrategy } from './Strategies/';
import * as Rules from './Strategies/rules';

// Responsible for collecting measurement strategy,
// watching for measurement changes,
// tracking how long an element is viewable for,
// and notifying listeners of changes
export default class MeasurementExecutor {
  constructor(element, strategy = {}) {
    this.timers = {};
    this.listeners = { start: [], change: [], complete: [], unmeasureable: [] };
    this.element = element;
    this.strategy = Object.assign({}, defaultStrategy, strategy); // ensure all strategy properties are included
    // this.tactics = strategy
    //                 .tactics
    //                 .map(this.instantiateTactic.bind(this))
    //                 .filter(this.strategy.technique_preference);

    // this.selectedTactic = this.chooseTactic(this.tactics);

    this.tactic = this.selectTactic(this.strategy.tactics);

    if(this.unmeasureable) {
      // fire unmeasureable after current JS loop completes 
      // so opportunity is given for consumers to provide unmeasureable callback
      setTimeout( () => this.listeners.unmeasureable.forEach( m => m() ), 0);
    }
  }

  instantiateTactic(ITactic) {
    if(typeof ITactic === 'function') {
      const instance = new ITactic(element,this.strategy.criteria);
      
      instance.id = new Date().getTime();
      instance.onInView(this.tacticChange.bind(this,'inview',instance));
      instance.onViewChange(this.tacticChange.bind(this,'change',instance));
      instance.onOutView(this.tacticChange.bind(this,'outview',instance));
      
      if(this.strategy.autostart) {
        instance.start();
      }

      return instance;
    }
  }

  tacticChange(change, tactic) {
    let timer = this.timers[tactic.id] || new InViewTimer(this.strategy.criteria.timeInView);

    switch(change) {
      case 'inview':
        if(!timer) {
          timer.elapsed(this.timerElapsed.bind(this, tactic));
          this.timers[tactic.id] = timer;
        }
        timer.start();
        this.listeners.start.forEach( l => l(tactic) );
        break;
      case 'change':
        this.listeners.change.forEach( l => l(tactic) );
        break;
      case 'outview':
        if(timer) {
          timer.pause();
        }
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
    // if all tactics are unmeasureable, return true, otherwise return false
    return this.tactics.reduce( (t, unmeasureable) => t.unmeasureable && unmeasureable, true);
  }

  start() {
    this.tactics.forEach( m => m.start && m.start() );
  }

  // Main event dispatchers
  onViewableStart(callback) {
    return this.addCallback(callback, 'start');
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
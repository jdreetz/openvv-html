import InViewTimer from '../Timing/InViewTimer';
import { defaultStrategy } from './Strategies/';
import * as Rules from './Strategies/rules';

// Responsible for collecting measurement strategy,
// watching for measurement changes,
// tracking how long an element is viewable for,
// and notifying listeners of changes
export default class MeasurementExecutor {
  constructor(element, strategy = defaultStrategy()) {
    this.timers = {};
    this.listeners = { start: [], complete: [], unmeasureable: [] };
    this.element = element;
    this.strategy = strategy;
    this.measureables = strategy.measureables.map(this.instantiateMeasureable.bind(this));
    if(this.unMeasureable()) {
      // fire unmeasureable after current JS loop completes 
      // so opportunity is given for consumers to provide unmeasureable callback
      setTimeout( () => this.listeners.unmeasureable.forEach( m => m() ), 0);
    }
  }

  instantiateMeasureable(Measureable) {
    if(typeof Measureable === 'function') {
      const instance = new Measureable(element,this.strategy.criteria);
      
      instance.id = new Date().getTime();
      instance.onInView(this.measureableChange.bind(this,'inview',instance));
      instance.onOutView(this.measureableChange.bind(this,'outview',instance));
      
      if(this.strategy.autostart) {
        instance.start();
      }

      return instance;
    }
  }

  measureableChange(change, measureable) {
    let timer = this.timers[measureable.id];

    switch(change) {
      case 'inview':
        if(!timer) {
          timer = new InViewTimer(this.strategy.criteria.timeInView);
          timer.elapsed(this.timerElapsed.bind(this,measureable));
          this.timers[measureable.id] = timer;
        }
        timer.start();
        this.listeners.start.forEach( l => l(measureable) );
        break;
      case 'outview':
        if(timer) {
          timer.pause();
        }
        break;
    }
  }

  timerElapsed(measureable) {
    if(this.strategy.rule === Rules.ANY || (this.strategy.rule === Rules.ALL && this.allCompleted())) {
      this.listeners.complete.forEach( l => l(measureable) );
    }
  }

  addCallback(callback, event) {
    if(this.listeners[event] && typeof callback === 'function') {
      this.listeners[event].push(callback);
    }

    return this;
  }

  allCompleted() {
    return this.completedTimers() === this.measureables.length;
  }

  completedTimers() {
    return this.timers.reduce( (count,timer) => timer.completed ? count + 1 : count, 0);
  }

  unMeasureableCount() {
    return this.measureables.reduce( (count,m) => m.unmeasureable ? count + 1 : count, 0);
  }

  unMeasureable() {
    if(this.strategy.rule === Rules.ANY && this.unMeasureableCount() > 0) {
      return true;
    }
    else if(this.strategy.rule === Rules.ALL && this.unMeasureableCount() === this.measureables.length) {
      return true;
    }

    return false;
  }

  start() {
    this.measureables.forEach( m => m.start && m.start() );
  }

  // Main event dispatchers
  onViewableStart(callback) {
    return this.addCallback(callback,'start');
  }

  onViewableComplete(callback) {
    return this.addCallback(callback,'complete');
  }

  onUnMeasureable(callback) {
    return this.addCallback(callback,'unmeasureable');
  }
}
import { defaultStrategy } from './defaults';
import * from ViewableStrategies from './Strategies/';
import InViewTimer from './Timing/InViewTimer';

// Responsibility - track and notify element viewability

export default class MeasurementController {
  constructor(config) {
    this.config = config;
    this.measureables = [];
    this.timers = [];
  }

  addMeasureable(element, strategy) {
    strategy = Object.assign(defaultStrategy,strategy);
    const dispatcher = new ViewableEventDispatcher(strategy.viewableStrategy);

    this.measureables.concat(strategy.measureables.map( Measureable => {
      const m = new Measureable(element);
      dispatcher.addMeasureable(m);
      m.onInView(() => {
        dispatcher.markViewableStart(m);
        this.startTimer(dispatcher,m);
      });
    }));

    return dispatcher;
  }

  startTimer(dispatcher, measureable) {
    const timer = new InViewTimer(dispatcher.strategy.criteria.timeInView);
    timer.elapsed( () => dispatcher.markViewableComplete(measureable) );
    timers.push(timer);
  }

  start() {

  }

  stop() {

  }

  pause() {
    timers.forEach(timer => timer.pause());
  }

  resume() {
    timers.forEach(timer => timer.resume());
  }
}

// Responsibility - fire callbacks on events occur

class ViewableEventDispatcher {
  constructor(strategy) {
    this.strategy = strategy;
    this.measureables = [];
    this.events = {
      viewableStart:[],
      viewableComplete:[],
      unmeasureable:[]
    };
    this.unmeasureable = true;
  }

  addMeasureable(measureable) {
    this.measureables.push(measureable);
    this.unmeasureable = !measureable.canMeasure() && this.unmeasureable ? false : true;
  }

  markViewableStart(measureable) {
    eventShouldFire(this.strategy, () => this.events.viewableStart.forEach( e => e(); ));
  }

  markViewableComplete(measureable) {
    eventShouldFire(this.strategy, () => this.events.viewableComplete.forEach( e => e(); ));
  }

  eventShouldFire(strategy, event) {
    switch(strategy) {
      case ALL_VIEWABLE:
        break;
      case FIRST_VIEWABLE:
        event();
        break; 
    }
  }

  onViewableStart(cb) {
    this.events.viewableStart.push(cb);
    return this;
  }

  onViewableComplete(cb) {
    this.events.viewableComplete.push(cb);
    return this;
  }

  onUnMeasureable(cb) {
    this.events.unmeasureable.push(cb);
    if(this.unmeasureable) {
      cb();
    }
    return this;
  }

}
import InViewTimer from '../Timing/InViewTimer';
import { defaultStrategy } from './Strategies/';
import { validTechnique, validateStrategy } from '../Helpers/Validators';
import * as Environment from '../Environment/Environment';
import * as Events from './Events';

// Responsible for collecting measurement strategy,
// watching for measurement changes,
// tracking how long an element is viewable for,
// and notifying listeners of changes
export default class MeasurementExecutor {
  constructor(element, strategy = {}) {
    this._listeners = { start: [], stop: [], change: [], complete: [], unmeasureable: [] };
    this._element = element;
    this._strategy = Object.assign({}, defaultStrategy, strategy);
    this._criteriaMet = false;

    const validated = validateStrategy(this._strategy);

    if(validated.invalid) {
      throw validated.reasons;
    }

    this._technique = this._selectTechnique(this._strategy.techniques);
    
    if(this._technique) {
      this._addSubscriptions(this._technique);
    }   

    if(this.unmeasureable) {
      // fire unmeasureable after current JS loop completes 
      // so opportunity is given for consumers to provide unmeasureable callback
      setTimeout( () => this._publish(Events.UNMEASUREABLE, Environment.getDetails(this._element)), 0);
    }
    else if(this._strategy.autostart) {
      this._technique.start();
    }
  }

  start() {
    this._technique.start();
  }

  dispose() {
    if(this._technique) {
      this._technique.dispose();
    }
    if(this.timer) {
      this.timer.dispose();
    }

  }

  // Expose callback interfaces to API consumer
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
    return !this._technique || this._technique.unmeasureable;
  }

  // select first technique that is not unmeasureable
  _selectTechnique(techniques) {
    return techniques
            .filter(validTechnique)
            .map(this._instantiateTechnique.bind(this))
            .find(technique => !technique.unmeasureable);
  }

  _instantiateTechnique(technique) {
    return new technique(element, this._strategy.criteria);
  }

  _addSubscriptions(technique) {
    if(technique) {
      technique.onInView(this._techniqueChange.bind(this, Events.INVIEW, technique));
      technique.onChangeView(this._techniqueChange.bind(this, Events.CHANGE, technique));
      technique.onOutView(this._techniqueChange.bind(this, Events.OUTVIEW, technique));
    }
  }

  _techniqueChange(change, technique) {
    let eventName;
    const details = this._appendEnvironment(technique);

    switch(change) {
      case Events.INVIEW:
        if(!this._criteriaMet){
          this.timer = new InViewTimer(this._strategy.criteria.timeInView);
          this.timer.elapsed(this._timerElapsed.bind(this, technique));
          this.timer.start();
          eventName = Events.START;
        }
        
        break;

      case Events.CHANGE:
        eventName = change;
        break;

      case Events.COMPLETE:
        if(!this._criteriaMet) {
          this._criteriaMet = true;
          eventName = change;
        }
        
        break;

      case Events.OUTVIEW:
        if(!this._criteriaMet) {
          if(this.timer) {
            this.timer.stop();
            delete this.timer;
          }
          eventName = Events.STOP;
        }
        
        break;
    }

    if(eventName) {
      this._publish(eventName, details);
    }
  }

  _publish(event, value) {
    if(Array.isArray(this._listeners[event])) {
      this._listeners[event].forEach( l => l(value) );
    }
  }

  _timerElapsed(technique) {
    this._techniqueChange(Events.COMPLETE, technique);
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

  _appendEnvironment(technique) {
    return Object.assign(
      {}, 
      { 
        percentViewable: technique.percentViewable, 
        technique: technique.techniqueName, 
        viewable: technique.viewable 
      }, 
      Environment.getDetails(this._element) 
    );
  }
}
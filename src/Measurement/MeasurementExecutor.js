import InViewTimer from '../Timing/InViewTimer';
import { defaultStrategy } from './Strategies/';
import { validTechnique, validateStrategy } from '../Helpers/Validators';
import * as Environment from '../Environment/Environment';
import * as Events from './Events';

/**
 * Class representing a measurement executor
 */
export default class MeasurementExecutor {
  /**
   * Create a new instance of a MeasurementExecutor
   * @param {HTMLElement} element - a HTML element to measure
   * @param {Object} strategy - a strategy object defining the measurement techniques and what criteria constitute a viewable state.
   * See OpenVV.Strategies defaultStrategy and StrategyFactory for more details on required params
   */
  constructor(element, strategy = {}) {
    /** @private {Object} event listener arrays */
    this._listeners = { start: [], stop: [], change: [], complete: [], unmeasureable: [] };
    /** @private {HTMLElement} HTML element to measure */
    this._element = element;
    /** @private {Object} measurement strategy */
    this._strategy = Object.assign({}, defaultStrategy, strategy);
    /** @private {Boolean} tracks whether viewability criteria has been met */
    this._criteriaMet = false;

    const validated = validateStrategy(this._strategy);

    if(validated.invalid) {
      throw validated.reasons;
    }

    /** @private {BaseTechnique} technique to measure viewability with */
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

  /** starts viewability measurment using the selected technique */
  start() {
    this._technique.start();
  }

  /** dispose the measurment technique and any timers */
  dispose() {
    if(this._technique) {
      this._technique.dispose();
    }
    if(this.timer) {
      this.timer.dispose();
    }
  }

  /**
   * Handle viewability tracking start
   * @param  {Function~viewableStartCallback} callback - is called when viewability starts tracking
   * @return {MeasurmentExecutor} - returns instance of MeasurementExecutor associated with this callback
   */
  onViewableStart(callback) {
    return this._addCallback(callback, Events.START);
  }

  /**
   * @callback Function~viewableStartCallback
   * @param {Object} details - environment and measurement details of viewable event
   */

  onViewableStop(callback) {
    return this._addCallback(callback, Events.STOP);
  }

  onViewableChange(callback) {
    return this._addCallback(callback, Events.CHANGE);
  }

  onViewableComplete(callback) {
    this._addCallback(callback, Events.COMPLETE);
    if(this.criteriaMet) {
      this._techniqueChange(Events.COMPLETE, this._technique);
    }
    return this;
  }

  onUnmeasureable(callback) {
    this._addCallback(callback, Events.UNMEASUREABLE);
    if(this.unmeasureable) {
      this._techniqueChange(Events.UNMEASUREABLE)
    }
    return this;
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

  _techniqueChange(change, technique = {}) {
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

      case Events.UNMEASUREABLE: 
        eventName = Events.UNMEASUREABLE;
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
        percentViewable: technique.percentViewable || -1, 
        technique: technique.techniqueName || -1, 
        viewable: technique.viewable || -1 
      }, 
      Environment.getDetails(this._element) 
    );
  }
}
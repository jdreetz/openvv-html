import Basetechnique from './Basetechnique';
import { validElement } from '../../Helpers/Validators';

export default class IntersectionObserver extends Basetechnique {
  constructor(element, criteria) {
    super(element, criteria);
    if(criteria !== undefined && element) {
      this.element = element;
      this.criteria = criteria;
      this.inView = false;
      this.started = false;
      this.notificationLevels = [0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1];
      if(this.notificationLevels.indexOf(this.criteria.inViewThreshold) === -1) {
        this.notificationLevels.push(this.criteria.inViewThreshold);
      }
    }
    else if(!element) {
      throw 'element not provided';
    } 
    else if(!criteria) {
      throw 'criteria not provided';
    }
  }

  start() {
    this.observer = new window.IntersectionObserver(this.viewableChange.bind(this),{ threshold: this.notificationLevels });
    this.observer.observe(this.element);
  }

  dispose() {
    if(this.observer) {
      this.observer.unobserve(element);
      this.observer.disconnect(element);
    }
  }

  get unmeasureable() {
    return (!window.IntersectionObserver || this.usesPolyfill ) || !validElement(this.element);
  }

  get viewable() {
    return this.inView;
  }

  get techniqueName() {
    return 'IntersectionObserver';
  }

  // infer polyfill usage by checking if IntersectionObserver API has THROTTLE_TIMEOUT memmber
  get usesPolyfill() {
    return typeof window.IntersectionObserver.prototype.THROTTLE_TIMEOUT === 'number';
  }

  viewableChange(entries) {
    if(entries && entries.length && entries[0].intersectionRatio !== undefined) {
      this.percentViewable = entries[0].intersectionRatio;
      
      if(entries[0].intersectionRatio < this.criteria.inViewThreshold && this.started) {
        this.inView = false;
        this.listeners.outView.forEach( l => l() );
      }
      if(entries[0].intersectionRatio >= this.criteria.inViewThreshold) {
        this.started = true;
        this.inView = true;
        this.listeners.inView.forEach( l => l() );
      }

      this.listeners.changeView.forEach( l => l() );
    }
  }

}
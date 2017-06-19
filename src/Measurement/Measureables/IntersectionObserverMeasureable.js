import AbstractMeasureable from './AbstractMeasureable';

export default class IntersectionObserverMeasureable extends AbstractMeasureable {
  constructor(element, criteria) {
    super();
    if(criteria !== undefined && element && this.canMeasure()) {
      this.element = element;
      this.criteria = criteria;
      this.observer = new IntersectionObserver(this.viewableChange.bind(this),{ threshold: criteria.inViewThreshold });
    } 
  }

  start() {
    this.observer.observe(this.element);
  }

  canMeasure() {
    return !!window.IntersectionObserver;
  }

  viewableChange(entries) {
    if(entries && entries.length && entries[0].intersectionRatio !== undefined) {
      this.percentViewable = entries[0].intersectionRatio;
      
      if(entries[0].intersectionRatio === 0.0) {
        this.listeners.outView.forEach( l => l(this.percentViewable) );
      }
      if(entries[0].intersectionRatio >= this.criteria.inViewThreshold) {
        this.listeners.inView.forEach( l => l(this.percentViewable) );
      }
    }
  }

}
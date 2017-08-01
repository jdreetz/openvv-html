import AbstractTactic from './AbstractTactic';

export default class IntersectionObserver extends AbstractTactic {
  constructor(element, criteria) {
    super();
    if(criteria !== undefined && element) {
      this.element = element;
      this.criteria = criteria;
      this.inView = false;
    }
    else if(!element) {
      throw 'element not provided';
    } 
    else if(!criteria) {
      throw 'criteria not provided';
    }
  }

  start() {
    this.observer = new window.IntersectionObserver(this.viewableChange.bind(this),{ threshold: criteria.inViewThreshold });
    this.observer.observe(this.element);
  }

  get unmeasureable() {
    return !window.IntersectionObserver;
  }

  get viewable() {
    return this.inView;
  }

  viewableChange(entries) {
    if(entries && entries.length && entries[0].intersectionRatio !== undefined) {
      this.percentViewable = entries[0].intersectionRatio;
      
      if(entries[0].intersectionRatio === 0.0) {
        this.inView = false;
        this.listeners.outView.forEach( l => l(this.percentViewable) );
      }
      if(entries[0].intersectionRatio >= this.criteria.inViewThreshold) {
        this.inView = true;
        this.listeners.inView.forEach( l => l(this.percentViewable) );
      }
    }
  }

}
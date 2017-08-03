import BaseTactic  from './BaseTactic';

export default class IntersectionObserver extends BaseTactic {
  constructor(element, criteria) {
    super(element, criteria);
    if(criteria !== undefined && element) {
      this.element = element;
      this.criteria = criteria;
      this.inView = false;
      this.started = false;
    }
    else if(!element) {
      throw 'element not provided';
    } 
    else if(!criteria) {
      throw 'criteria not provided';
    }
  }

  start() {
    this.observer = new window.IntersectionObserver(this.viewableChange.bind(this),{ threshold: this.criteria.inViewThreshold });
    this.observer.observe(this.element);
  }

  get unmeasureable() {
    return (
        !window.IntersectionObserver || 
        typeof window.IntersectionObserver.prototype.THROTTLE_TIMEOUT === 'number'
      ) && 
      this.element.toString().indexOf('Element') > -1; // ensure intersection observer is available and element is an actual element and not a proxy
  }

  get viewable() {
    return this.inView;
  }

  get tacticName() {
    return 'IntersectionObserver';
  }

  viewableChange(entries) {
    if(entries && entries.length && entries[0].intersectionRatio !== undefined) {
      this.percentViewable = entries[0].intersectionRatio;
      
      if(entries[0].intersectionRatio < this.criteria.inViewThreshold && this.started) {
        this.inView = false;
        this.listeners.outView.forEach( l => l(this.percentViewable) );
      }
      if(entries[0].intersectionRatio >= this.criteria.inViewThreshold) {
        this.started = true;
        this.inView = true;
        this.listeners.inView.forEach( l => l(this.percentViewable) );
      }
    }
  }

}
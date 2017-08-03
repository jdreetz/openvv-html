export default class BaseTactic {
  constructor() {
    this.listeners = {
      inView:[],
      outView:[]
    };

    this.percentViewable = 0.0;
  }

  // element is in view according to strategy defined by concrete measurement class
  onInView(cb) {
    return this.addCallback(cb,'inView');
  }

  onChangeView(cb) {
    return this.addCallback(cb,'viewChange');
  }

  // element no longer in view
  onOutView(cb) {
    return this.addCallback(cb,'outView');
  }

  addCallback(callback, event) {
    if(typeof callback === 'function' && this.listeners[event]) {
      this.listeners[event].push(callback);
    }
    else if(typeof callback !== 'function') {
      throw 'callback must be function';
    }

    return this;
  }

  get unmeasureable() {
    return false;
  }

  get viewable() {
    return false;
  }
}
export default class AbstractObserver {
  constructor() {
    this.listeners = [];
  }

  onInView(cb) {
    this.listeners.push(cb);
  }

  canMeasure() {
    return false;
  }
}
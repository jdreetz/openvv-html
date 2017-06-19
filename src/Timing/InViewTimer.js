export default class InViewTimer {
  constructor(duration) {
    this.duration = duration;      
    this.listeners = [];
    this.completed = false;
  }

  timerComplete() {
    this.completed = true;
    this.listeners.forEach( l => l() );
  }

  elapsed(cb) {
    if(typeof cb === 'function') {
      this.listeners.push(cb);
    }
  }

  start() {
    if(this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(this.timerComplete.bind(this),this.duration);
  }

  pause() {
    clearTimeout(this.timer);
  }

  resume() {
    this.timer = setTimeout(this.timerComplete.bind(this),this.duration);
  }

}
export default class InViewTimer {
  constructor(duration) {
    this.duration = duration;
    this.timer = setTimeout(this.timerComplete.bind(this),duration);  
    this.listeners = [];
  }

  timerComplete() {
    this.listeners.forEach( listener => listener() );
  }

  elapsed(cb) {
    this.listeners.push(cb);
  }

  pause() {
    clearTimeout(this.timer);
  }

  resume() {
    this.timer = setTimeout(this.timerComplete.bind(this),this.duration);
  }

}
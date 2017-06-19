import * as ViewabilityCriteria from './Options/ViewabilityCriteria';
// import MeasurementController from 'Measurement/MeasurementController';
import MeasurementExecutor from './Measurement/MeasurementExecutor';
import { defaultStrategy } from './Measurement/Strategies/';
// import MeasureableElement from './Measurement/MeasureableElement';
// import MeasurementMonitor from './'

// Main entry point
export default class OpenVV {
  constructor(userDefaults) {
    // if(config !== undefined) {
    //   this.config = config;
    //   this.initController(config);
    // }
    this.executors = [];
    // this.globalStrategy = Object.assign(defaultStrategy(),userDefaults);
  }

  configure(config) {
    this.config = config;
    // initController(config);
  }

  measureElement(element, strategy) {
    const executor = new MeasurementExecutor(element,strategy);
    this.executors.push(executor);
    return executor;
  } 
}

// Expose support classes / constants
OpenVV.ViewabilityCriteria = ViewabilityCriteria;
// OpenVV.MeasureableElement = MeasureableElement;
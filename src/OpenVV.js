import * as ViewabilityCriteria from './Options/ViewabilityCriteria';
import MeasurementExecutor from './Measurement/MeasurementExecutor';
import * as Measureables from './Measurement/Measureables/';
import * as Rules from './Measurement/Strategies/rules';

// Main entry point
export default class OpenVV {
  constructor(userDefaults) {
    this.executors = [];
  }

  configure(config) {
    this.config = config;
  }

  measureElement(element, strategy) {
    const executor = new MeasurementExecutor(element, strategy);
    this.executors.push(executor);
    return executor;
  } 
}

// Expose support classes / constants
OpenVV.ViewabilityCriteria = ViewabilityCriteria;
OpenVV.Measureables = Measureables;
OpenVV.Rules = Rules;
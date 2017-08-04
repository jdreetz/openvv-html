import * as Events from './Measurement/Events';
import InViewTimer from './Timing/InViewTimer';
import * as Strategies from './Measurement/Strategies/';
import * as Environment from './Environment/Environment';
import MeasurementExecutor from './Measurement/MeasurementExecutor';
import * as ViewabilityCriteria from './Options/ViewabilityCriteria';
import * as MeasurementTechniques from './Measurement/MeasurementTechniques/';

// Main entry point
export default class OpenVV {
  constructor() {
    this.executors = [];
  }

  measureElement(element, strategy) {
    const executor = new MeasurementExecutor(element, strategy);
    this.executors.push(executor);
    return executor;
  } 
}

// Expose support classes / constants
OpenVV.ViewabilityCriteria = ViewabilityCriteria;
OpenVV.MeasurementExecutor = MeasurementExecutor;
OpenVV.MeasurementTechniques = MeasurementTechniques;
OpenVV.InViewTimer = InViewTimer;
OpenVV.Strategies = Strategies;
OpenVV.Events = Events;
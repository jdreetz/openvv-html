import * as ViewabilityCriteria from './Options/ViewabilityCriteria';
import MeasurementController from 'Measurement/MeasurementController';
// import MeasureableElement from './Measurement/MeasureableElement';
// import MeasurementMonitor from './'

// Main entry point
export default class OpenVV {
  constructor(config) {
    this.config = config;
    this.controller = config.controller || new MeasurementController(config);
  }

  configure(config) {
    this.config = config;
  }

  setController(controller) {
    this.controller = controller;
  }

  measureElement(element, strategy) {
    return this.controller.addMeasureable(element,strategy);
  }

  beginMeasurement() {

  }

  pauseMeasurement() {

  }

  resumeMeasurement() {

  }

  endMeasurement() {

  }
}

// Expose support classes / constants
OpenVV.ViewabilityCriteria = ViewabilityCriteria;
// OpenVV.MeasureableElement = MeasureableElement;
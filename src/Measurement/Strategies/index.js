import * as Validators from '../../Helpers/Validators';
import * as MeasurementTechniques from '../MeasurementTechniques/';
import * as ViewabilityCriteria from '../../Options/ViewabilityCriteria';

export const defaultStrategy = {
  autostart: true,
  techniques: [MeasurementTechniques.IntersectionObserver, MeasurementTechniques.IntersectionObserverPolyfill],
  criteria: ViewabilityCriteria.MRC_VIDEO
};

export const StrategyFactory = (autostart = defaultStrategy.autostart, techniques = defaultStrategy.techniques, criteria = defaultStrategy.criteria) => {
  const strategy = { autostart, techniques, criteria },
        validated = Validators.validateStrategy(strategy);  

  if(validated.invalid) {
    throw validated.reasons;
  }

  return strategy;
};
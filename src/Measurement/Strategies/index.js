import * as Validators from '../../Helpers/Validators';
import * as MeasurementTactics from '../MeasurementTactics/';
import * as ViewabilityCriteria from '../../Options/ViewabilityCriteria';

export const defaultStrategy = {
  autostart: true,
  tactics: [MeasurementTactics.IntersectionObserver, MeasurementTactics.IntersectionObserverPolyfill],
  criteria: ViewabilityCriteria.MRC_VIDEO
};

export const StrategyFactory = (autostart = defaultStrategy.autostart, tactics = defaultStrategy.tactics, criteria = defaultStrategy.criteria) => {
  const strategy = { autostart, tactics, criteria },
        validated = Validators.validateStrategy(strategy);  

  if(validated.invalid) {
    throw validated.reasons;
  }

  return strategy;
};
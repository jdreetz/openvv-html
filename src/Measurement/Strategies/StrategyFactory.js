import { defaultStrategy } from './index';

export const StrategyFactory = (autostart, rule, measureables, criteria) => {
  const strategy = { autostart, rule, measureables, criteria }, defaults = defaultStrategy();
  return Object.assign(defaults,strategy);
};
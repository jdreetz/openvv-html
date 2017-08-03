import BaseTactic from '../Measurement/MeasurementTactics/BaseTactic';

// ensure tactic atleast has the same properties and methods of AbstractTimer
export const validTactic = (tactic) => {
  const valid = 
    typeof tactic === 'function' &&
    Object
      .getOwnPropertyNames(BaseTactic)
      .reduce( (prop, valid) => valid && typeof tactic[prop] === typeof BaseTactic[prop], true);

  return valid;
};

export const validateCriteria = ({ inViewThreshold, timeInView }) => {
  let invalid = false, reasons = []; 

  if(typeof inViewThreshold !== 'number' || inViewThreshold > 1) {
    invalid = true;
    reasons.push('inViewThreshold must be a number equal to or less than 1');
  }

  if(typeof timeInView !== 'number' || timeInView < 0) {
    invalid = true;
    reasons.push('timeInView must be a number greater to or equal 0');
  }

  return { invalid, reasons: reasons.join(' | ') };
};

export const validateStrategy = ({ autostart, tactics, criteria }) => {
  let invalid = false, reasons = [];

  if(typeof autostart !== 'boolean') {
    invalid = true;
    reasons.push('autostart must be boolean');
  }

  if(!Array.isArray(tactics) || tactics.length === 0) {
    invalid = true;
    reasons.push('tactics must be an array containing atleast on measurement tactics');
  }

  const validated = validateCriteria(criteria);

  if(validated.invalid) {
    invalid = true;
    reasons.push(validated.reasons);
  }

  return { invalid, reasons: reasons.join(' | ') };
};
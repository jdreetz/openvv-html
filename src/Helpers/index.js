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
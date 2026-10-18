export function harmonicState(
  inputAngle: number,
  inputRpm: number,
  flexTeeth: number,
  ringTeeth: number,
) {
  const ratio = -(ringTeeth - flexTeeth) / flexTeeth,
    outputAngle = inputAngle * ratio;
  return {
    inputAngle,
    outputAngle,
    inputRpm,
    outputRpm: inputRpm * ratio,
    ratio,
    cos: Math.cos(2 * (inputAngle - outputAngle)),
    sin: Math.sin(2 * (inputAngle - outputAngle)),
  };
}

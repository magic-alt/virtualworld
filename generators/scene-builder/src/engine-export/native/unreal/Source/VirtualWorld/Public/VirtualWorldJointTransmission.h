#pragma once
#include "VirtualWorldJointDynamics.h"

namespace VWJoint {
// Multipliers of the input/wave angle. Ratio provenance is kept in the adapter JSON.
struct Transmission { double flex=0,circular=0,output=0; bool resolved=false; };
inline Transmission statedTransmission(double reductionRatio,bool flexFixed) {
    if(!std::isfinite(reductionRatio)||reductionRatio<=0)invalid("Invalid stated reduction ratio");
    const double output=(flexFixed?1.:-1.)/reductionRatio;
    return {flexFixed?0.:output,flexFixed?output:0.,output,true};
}
inline Transmission toothTransmission(double flexTeeth,double circularTeeth,bool flexFixed) {
    if(!std::isfinite(flexTeeth)||!std::isfinite(circularTeeth)||flexTeeth<=0||circularTeeth<=flexTeeth)invalid("Invalid tooth counts");
    // Zf(thetaF-thetaW) = Zc(thetaC-thetaW).
    return statedTransmission((flexFixed?circularTeeth:flexTeeth)/(circularTeeth-flexTeeth),flexFixed);
}
}

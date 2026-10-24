#pragma once
// Portable SI core. Keep equations and event thresholds aligned with packages/engine/src/joint-dynamics.ts.
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <limits>
#include <cstdlib>
#include <string>
namespace VWJoint {
[[noreturn]] inline void invalid(const char* message) {
#if defined(__cpp_exceptions)
    throw std::invalid_argument(message);
#else
    (void)message; std::abort(); // Native adapter rejects invalid serialized input before constructing the solver.
#endif
}
constexpr double Pi=3.1415926535897932384626433832795;
inline double sign(double x) { return (x>0)-(x<0); }
struct Config {
    double inertia=.00012,driveTorque=.012,brakeTorque=.06,holdTorque=.08,viscousDrag=.00002;
    double engageDelay=.025,engageRamp=.04,releaseDelay=.02,releaseRamp=.035,armatureTravel=.00015;
    bool valid() const {
        for(double x:{inertia,driveTorque,brakeTorque,holdTorque}) if(!std::isfinite(x)||x<1e-9) return false;
        for(double x:{viscousDrag,engageDelay,engageRamp,releaseDelay,releaseRamp,armatureTravel}) if(!std::isfinite(x)||x<0) return false;
        for(double x:{engageDelay,engageRamp,releaseDelay,releaseRamp}) if(x>60||(x>0&&x<1e-9)) return false;
        return inertia<=1e3&&driveTorque<=1e6&&brakeTorque<=1e6&&holdTorque<=1e6&&viscousDrag<=1e6&&armatureTravel<=.01&&holdTorque>=brakeTorque;
    }
};
struct Rolling {double cageAngle,relativeBallAngle,worldBallAngle;};
inline Rolling rollingState(double inner,double outer,double R,double r) {
    if(!std::isfinite(inner)||!std::isfinite(outer)||!std::isfinite(R)||!std::isfinite(r)||r<=0||R<=r) invalid("Invalid radial rolling geometry");
    const double ri=R-r,ro=R+r,cage=(inner*ri+outer*ro)/(2*R),relative=(outer-inner)*ri*ro/(2*R*r);
    return {cage,relative,cage+relative};
}
struct Integral {double omega,angle;};
inline Integral integrate(double omega,double a,double b,double k,double t) {
    const double x=k*t; double i0,i1,i2;
    if(std::abs(x)<.05) {
        double term=1,p0=1,p1=.5,p2=1./6;
        for(int n=1;n<12;++n) {term*=-x/n;p0+=term/(n+1);p1+=term/((n+1)*(n+2));p2+=term/((n+1)*(n+2)*(n+3));}
        i0=t*p0;i1=t*t*p1;i2=t*t*t*p2;
    } else {i0=-std::expm1(-x)/k;i1=(t-i0)/k;i2=(t*t/2-i1)/k;}
    return {omega*std::exp(-x)+a*i0+b*i1,omega*i0+a*i1+b*i2};
}
struct Snapshot {
    double angle,omega,time,dissipatedEnergy,kineticEnergy,closure;
    const char* brakePhase; bool powered,installed,running; double targetRpm;
};
class Dynamics {
public:
    explicit Dynamics(Config value=Config()):config(value) {if(!config.valid()) invalid("Invalid joint dynamics config");}
    const Config config;
    bool start() {if(!powered||(installed&&(closure!=0||transitioning))) return false;running=true;stopping=false;return true;}
    void stop() {running=false;stopping=true;}
    void setRpm(double rpm) {if(!std::isfinite(rpm)||std::abs(rpm)>100000) invalid("Invalid RPM");targetRpm=rpm;}
    void setPowered(bool value) {if(powered==value)return;powered=value;if(!powered){running=false;stopping=false;}beginTransition();}
    void setInstalled(bool value) {if(installed==value)return;installed=value;if(!installed){closure=delay=0;transitioning=false;}else beginTransition();}
    void reset() {angle=omega=time=dissipatedEnergy=closure=delay=0;powered=installed=true;running=stopping=transitioning=false;targetRpm=6;}
    Snapshot snapshot() const {
        const char* phase=!installed?"uninstalled":transitioning&&delay>0?(powered?"release-delay":"engage-delay"):transitioning?(powered?"releasing":"engaging"):closure==0?"released":omega==0?"holding":"slipping";
        return {angle,omega,time,dissipatedEnergy,.5*config.inertia*omega*omega,closure,phase,powered,installed,running,targetRpm};
    }
    Snapshot tick(double elapsed,bool paused=false,double scale=1) {
        if(!std::isfinite(elapsed)||elapsed<0||!std::isfinite(scale)||scale<0||!std::isfinite(elapsed*scale)) invalid("Invalid elapsed time");
        if(paused||elapsed==0||scale==0)return snapshot();
        double remaining=elapsed*scale;
        while(remaining>0) {
            resolveInstantTransition();double duration=remaining,slope=0;
            if(transitioning) {
                if(delay>0)duration=std::min(duration,delay);
                else {const double ramp=powered?config.releaseRamp:config.engageRamp;slope=(powered?-1:1)/ramp;duration=std::min(duration,powered?closure*ramp:(1-closure)*ramp);}
            }
            advanceShaft(duration,slope);time+=duration;
            if(transitioning&&delay>0)delay=std::max(0.,delay-duration);else closure=std::clamp(closure+slope*duration,0.,1.);
            remaining=std::max(0.,remaining-duration);
            if(transitioning&&delay==0&&((powered&&closure<1e-14)||(!powered&&1-closure<1e-14))) {closure=powered?0:1;transitioning=false;}
        }
        resolveInstantTransition();return snapshot();
    }
private:
    double angle=0,omega=0,time=0,dissipatedEnergy=0,closure=0,targetRpm=6,delay=0;
    bool powered=true,installed=true,running=false,stopping=false,transitioning=false;
    void beginTransition() {
        if(!installed)return;
        if(closure==(powered?0:1)){transitioning=false;delay=0;return;}
        delay=powered?config.releaseDelay:config.engageDelay;transitioning=true;resolveInstantTransition();
    }
    void resolveInstantTransition(){if(transitioning&&delay<=0&&(powered?config.releaseRamp:config.engageRamp)==0){closure=powered?0:1;transitioning=false;}}
    void advanceShaft(double duration,double slope) {
        const auto& c=config;const double k=c.viscousDrag/c.inertia;double remaining=duration,local=0;
        while(remaining>0) {
            const double closed=closure+slope*local;const bool motor=powered&&(running||stopping);const double target=running?targetRpm*Pi/30:0;
            double drive=motor?sign(target-omega)*c.driveTorque:0,h=remaining;
            const bool atTarget=motor&&std::abs(omega-target)<1e-12;
            if(atTarget&&target!=0) {
                omega=target;const double required=c.brakeTorque*closed+c.viscousDrag*std::abs(target);
                if(required<=c.driveTorque+1e-14) {
                    if(slope>0)h=std::min(h,std::max(0.,(c.driveTorque-required)/(c.brakeTorque*slope)));
                    if(h>1e-13){angle+=target*h;dissipatedEnergy+=std::abs(target)*c.brakeTorque*(closed*h+slope*h*h/2)+c.viscousDrag*target*target*h;local+=h;remaining=std::max(0.,remaining-h);continue;}
                }
                drive=sign(target)*c.driveTorque;
            }
            if(omega==0) {
                if(std::abs(drive)<=c.holdTorque*closed) {
                    if(slope<0&&drive!=0)h=std::min(h,std::max(0.,(closed-std::abs(drive)/c.holdTorque)/-slope));
                    if(h>1e-13){local+=h;remaining=std::max(0.,remaining-h);continue;}
                }
                if(drive==0){local+=h;remaining=std::max(0.,remaining-h);continue;}
            }
            const double direction=omega!=0?sign(omega):sign(drive),a=(drive-direction*c.brakeTorque*closed)/c.inertia,b=-direction*c.brakeTorque*slope/c.inertia;
            const double derivative=a-k*omega;double extremum=std::numeric_limits<double>::infinity();
            if(k==0&&b!=0)extremum=-derivative/b;
            else if(k>0&&b!=0){const double ratio=-b/k/(derivative-b/k);if(ratio>0)extremum=-std::log(ratio)/k;}
            if(extremum>1e-12)h=std::min(h,extremum);
            const double initial=omega;bool hasEvent=false;double event=0;
            for(int index=0;index<(motor?2:1);++index) {
                const double boundary=index==0?0:target;
                if(initial==boundary||(initial-boundary)*(integrate(initial,a,b,k,h).omega-boundary)>0)continue;
                double lo=0,hi=h;
                for(int i=0;i<60;++i){const double mid=(lo+hi)/2,value=integrate(initial,a,b,k,mid).omega;if((initial-boundary)*(value-boundary)>0)lo=mid;else hi=mid;}
                if(hi<=h){h=hi;event=boundary;hasEvent=true;}
            }
            const auto result=integrate(initial,a,b,k,h);angle+=result.angle;omega=hasEvent?event:result.omega;
            dissipatedEnergy+=std::max(0.,drive*result.angle-c.inertia*(omega*omega-initial*initial)/2);
            if(stopping&&omega==0)stopping=false;local+=h;remaining=std::max(0.,remaining-h);
        }
    }
};
}

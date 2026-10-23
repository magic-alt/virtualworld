#pragma once
#include "CoreMinimal.h"

namespace VW
{
inline float ControlPanelWidth(float ViewportWidth) { return FMath::Min(450.f,FMath::Max(0.f,ViewportWidth)*.48f); }

// Match the rendered camera plane. UE camera FOV is horizontal, so use viewport width.
inline FVector PointerPan(const FVector& Offset,const FVector& Up,const FVector2D& Pixels,int32 ViewWidth,double HorizontalFov)
{
    if(ViewWidth<=0) return FVector::ZeroVector;
    const FVector Forward=-Offset.GetSafeNormal();
    const FVector Right=FVector::CrossProduct(Up,Forward).GetSafeNormal();
    const FVector ViewUp=FVector::CrossProduct(Forward,Right).GetSafeNormal();
    const double UnitsPerPixel=2.*Offset.Size()*FMath::Tan(FMath::DegreesToRadians(HorizontalFov*.5))/ViewWidth;
    return (-Right*Pixels.X+ViewUp*Pixels.Y)*UnitsPerPixel;
}

// Visible cursor gestures start in the viewport. Buttons first pressed on the HUD stay owned by it.
struct FPointerDrag
{
    FVector2D Previous=FVector2D::ZeroVector;
    uint8 PreviousButtons=0;
    uint8 Mode=0; // 0: idle, 1: orbit, 2: pan
    void Reset() {Previous=FVector2D::ZeroVector;PreviousButtons=0;Mode=0;}
    FVector2D Update(const FVector2D& Position,bool HasPosition,bool Focused,bool InViewport,bool Orbit,bool Pan)
    {
        if(!HasPosition||!Focused||!FMath::IsFinite(Position.X)||!FMath::IsFinite(Position.Y)) {Reset();return FVector2D::ZeroVector;}
        const uint8 Buttons=(Orbit?1:0)|(Pan?2:0);
        if((Mode==1&&!Orbit)||(Mode==2&&!Pan)) Mode=0;
        const uint8 Start=Pan&&!(PreviousButtons&2)?2:Orbit&&!Pan&&!(PreviousButtons&1)?1:0;
        PreviousButtons=Buttons;
        if(Start&&InViewport) {Mode=Start;Previous=Position;return FVector2D::ZeroVector;}
        if(!Mode) return FVector2D::ZeroVector;
        const FVector2D Delta=Position-Previous;Previous=Position;
        return Delta;
    }
};
}

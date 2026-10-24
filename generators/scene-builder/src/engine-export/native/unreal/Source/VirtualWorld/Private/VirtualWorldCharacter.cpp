#include "VirtualWorldRuntime.h"
#include "VirtualWorldModel.h"
#include "Camera/CameraActor.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "CollisionQueryParams.h"
#include "CollisionShape.h"
#include "Components/SceneComponent.h"

bool AVirtualWorldRuntime::BuildPlayer()
{
    const VW::Json Actor=VW::Object(Metadata,TEXT("actor"));
    PlayerHeight=static_cast<float>(VW::Number(Actor,TEXT("height"),1.6)*100.);
    PlayerRadius=FMath::Min(PlayerHeight*.15f,PlayerHeight*.45f);
    PlayerRoot=NewObject<USceneComponent>(this);
    AddInstanceComponent(PlayerRoot);PlayerRoot->SetupAttachment(RootComponent);PlayerRoot->RegisterComponent();SceneComponents.Add(PlayerRoot);
    PlayerModel=SpawnModel(VW::String(Scene,TEXT("actorModel")),PlayerRoot,false,true);
    if(!PlayerModel || !FatalError.IsEmpty()) return false;
    const VW::Json Clips=VW::Object(Actor,TEXT("clips"));
    for(const TCHAR* State:{TEXT("idle"),TEXT("walk"),TEXT("interact")})
        if(!PlayerModel->HasSkeletalClip(VW::String(Clips,State))) return Fail(TEXT("Missing player skeletal clip: ")+VW::String(Clips,State));
    const FBox Bounds=PlayerModel->GetComponentsBoundingBox(true);
    if(!Bounds.IsValid || Bounds.GetSize().Z<=KINDA_SMALL_NUMBER) return Fail(TEXT("Player model has no usable height bounds."));
    const float Scale=PlayerHeight/Bounds.GetSize().Z;
    const FQuat Facing=VW::CharacterFacing();
    const FVector BottomCenter(Bounds.GetCenter().X,Bounds.GetCenter().Y,Bounds.Min.Z);
    PlayerModel->SetActorRelativeTransform(FTransform(Facing,-Facing.RotateVector(BottomCenter)*Scale,FVector(Scale)));
    PlayerFeet=VW::Position(VW::Vector(Scene,TEXT("spawn")));
    PlayerUp=FVector::UpVector;
    const VW::Json Navigation=VW::Object(Metadata,TEXT("navigation"));
    if(VW::String(Navigation,TEXT("kind"))==TEXT("sphere"))
    {
        const FVector Center=VW::Position(VW::Vector(Navigation,TEXT("center")));
        PlayerUp=(PlayerFeet-Center).GetSafeNormal(SMALL_NUMBER,FVector::UpVector);
        PlayerFeet=Center+PlayerUp*VW::Number(Navigation,TEXT("radius"))*100.;
    }
    else
    {
        FHitResult Ground;
        FCollisionQueryParams Params(SCENE_QUERY_STAT(VirtualWorldSpawn),true);
        Params.AddIgnoredActor(PlayerModel);
        if(GetWorld()->LineTraceSingleByChannel(Ground,PlayerFeet+PlayerUp*PlayerHeight*2,PlayerFeet-PlayerUp*PlayerHeight*4,ECC_Pawn,Params) && FVector::DotProduct(Ground.ImpactNormal,PlayerUp)>.5)
            PlayerFeet=Ground.ImpactPoint;
    }
    PlayerForward=FVector::VectorPlaneProject(FVector::ForwardVector,PlayerUp).GetSafeNormal();
    if(PlayerForward.IsNearlyZero()) PlayerForward=FVector::VectorPlaneProject(FVector::RightVector,PlayerUp).GetSafeNormal();
    PlayerRoot->SetWorldLocationAndRotation(PlayerFeet,FRotationMatrix::MakeFromXZ(PlayerForward,PlayerUp).ToQuat());
    PlayPlayerClip(TEXT("idle"));
    return FatalError.IsEmpty();
}

void AVirtualWorldRuntime::PlayPlayerClip(const FString& State)
{
    if(!PlayerModel || State==PlayerClip) return;
    const FString Name=VW::String(VW::Object(VW::Object(Metadata,TEXT("actor")),TEXT("clips")),*State);
    if(!PlayerModel->PlayClip(Name,State!=TEXT("interact"))) { Fail(TEXT("Player animation unavailable: ")+Name);return; }
    PlayerClip=State;
}

void AVirtualWorldRuntime::StepPlayer(float DeltaSeconds)
{
    if(!PlayerModel || !PlayerRoot) return;
    APlayerController* PC=GetWorld()->GetFirstPlayerController();
    if(!PC) return;
    InteractionRemaining=FMath::Max(0.f,InteractionRemaining-DeltaSeconds);
    FVector Forward=FVector::VectorPlaneProject(-CameraOffset,PlayerUp).GetSafeNormal();
    if(Forward.IsNearlyZero()) Forward=PlayerForward;
    const FVector Right=FVector::CrossProduct(PlayerUp,Forward).GetSafeNormal();
    const float F=(PC->IsInputKeyDown(EKeys::W)?1.f:0.f)-(PC->IsInputKeyDown(EKeys::S)?1.f:0.f);
    const float R=(PC->IsInputKeyDown(EKeys::D)?1.f:0.f)-(PC->IsInputKeyDown(EKeys::A)?1.f:0.f);
    const FVector Direction=(Forward*F+Right*R).GetSafeNormal();
    const FVector Previous=PlayerFeet,OldUp=PlayerUp;
    if(!Direction.IsNearlyZero())
    {
        const VW::Json Navigation=VW::Object(Metadata,TEXT("navigation"));
        const bool bSphere=VW::String(Navigation,TEXT("kind"))==TEXT("sphere");
        FVector Proposed=PlayerFeet+Direction*260.*DeltaSeconds;
        FVector Up=PlayerUp;
        const FVector Center=VW::Position(VW::Vector(Navigation,TEXT("center")));
        const double Radius=VW::Number(Navigation,TEXT("radius"))*100.;
        if(bSphere)
        {
            Up=(Proposed-Center).GetSafeNormal(SMALL_NUMBER,PlayerUp);
            Proposed=Center+Up*Radius;
        }
        else
        {
            FVector Source=VW::SourcePosition(Proposed);
            const VW::Json Bounds=VW::Object(Navigation,TEXT("bounds"));
            const auto Min=VW::Array(Bounds,TEXT("min")),Max=VW::Array(Bounds,TEXT("max"));
            if(Min.Num()==2&&Max.Num()==2)
            {
                const double Pad=PlayerRadius/100.;
                const double MinX=Min[0]->AsNumber()+Pad,MaxX=Max[0]->AsNumber()-Pad;
                const double MinZ=Min[1]->AsNumber()+Pad,MaxZ=Max[1]->AsNumber()-Pad;
                Source.X=MinX<=MaxX?FMath::Clamp(Source.X,MinX,MaxX):(MinX+MaxX)/2;
                Source.Z=MinZ<=MaxZ?FMath::Clamp(Source.Z,MinZ,MaxZ):(MinZ+MaxZ)/2;
                Proposed=VW::Position(Source);
            }
            FHitResult Ground;
            FCollisionQueryParams GroundParams(SCENE_QUERY_STAT(VirtualWorldGround),true);
            GroundParams.AddIgnoredActor(PlayerModel);
            if(GetWorld()->LineTraceSingleByChannel(Ground,Proposed+Up*40.,Proposed-Up*PlayerHeight*2,ECC_Pawn,GroundParams) && FVector::DotProduct(Ground.ImpactNormal,Up)>.5)
                Proposed=Ground.ImpactPoint;
            else if(ColliderCount>0) Proposed=PlayerFeet;
        }
        const double HalfHeight=PlayerHeight*.5;
        const double Skin=FMath::Max(1.,PlayerHeight*.01);
        FCollisionQueryParams Params(SCENE_QUERY_STAT(VirtualWorldMove),true);
        Params.AddIgnoredActor(PlayerModel);
        const FCollisionShape Shape=FCollisionShape::MakeCapsule(PlayerRadius,HalfHeight);
        const FQuat Orientation=FQuat::FindBetweenNormals(FVector::UpVector,(OldUp+Up).GetSafeNormal(SMALL_NUMBER,Up));
        const FVector Start=PlayerFeet+OldUp*(HalfHeight+Skin),End=Proposed+Up*(HalfHeight+Skin);
        FHitResult Hit;
        if(GetWorld()->SweepSingleByChannel(Hit,Start,End,Orientation,ECC_Pawn,Shape,Params))
        {
            // Native Chaos capsule sweep, then one wall slide. No teleport through authored proxies.
            const FVector Move=End-Start;
            FVector Accepted=Start+Move*FMath::Max(0.f,Hit.Time-.001f);
            const FVector Slide=FVector::VectorPlaneProject(Move*(1-Hit.Time),Hit.Normal);
            FHitResult SlideHit;
            const bool bSlideHit=GetWorld()->SweepSingleByChannel(SlideHit,Accepted,Accepted+Slide,Orientation,ECC_Pawn,Shape,Params);
            Accepted+=Slide*(bSlideHit?FMath::Max(0.f,SlideHit.Time-.001f):1.f);
            Proposed=Accepted-Up*(HalfHeight+Skin);
            if(bSphere)
            {
                Up=(Proposed-Center).GetSafeNormal(SMALL_NUMBER,OldUp);
                Proposed=Center+Up*Radius;
            }
            else Proposed.Z=PlayerFeet.Z+(End.Z-Start.Z)*FMath::Clamp(Hit.Time,0.f,1.f);
        }
        PlayerFeet=Proposed;PlayerUp=Up;
        const FQuat Transport=FQuat::FindBetweenNormals(OldUp,PlayerUp);
        PlayerForward=FVector::VectorPlaneProject(Transport.RotateVector(Direction),PlayerUp).GetSafeNormal(SMALL_NUMBER,PlayerForward);
        if(bSphere) { CameraOffset=Transport.RotateVector(CameraOffset);CameraUp=Transport.RotateVector(CameraUp); }
        PlayerRoot->SetWorldLocationAndRotation(PlayerFeet,FRotationMatrix::MakeFromXZ(PlayerForward,PlayerUp).ToQuat());
    }
    PlayPlayerClip(InteractionRemaining>0?TEXT("interact"):(FVector::DistSquared(Previous,PlayerFeet)>.01?TEXT("walk"):TEXT("idle")));
}

void AVirtualWorldRuntime::UpdateCamera()
{
    if(!Camera) return;
    if(PlayerRoot) CameraTarget=PlayerFeet+PlayerUp*(PlayerHeight*.65);
    const FQuat Rotation=FRotationMatrix::MakeFromXZ(-CameraOffset,CameraUp).ToQuat();
    FVector ViewTarget=CameraTarget;
    if(VW::String(Metadata,TEXT("mode"))==TEXT("industrial"))
    {
        int32 Width=0,Height=0;
        if(APlayerController* PC=GetWorld()->GetFirstPlayerController()) PC->GetViewportSize(Width,Height);
        if(Width>0)
        {
            const double Panel=FMath::Min(450.,Width*.48);
            ViewTarget-=Rotation.GetRightVector()*CameraOffset.Size()*FMath::Tan(FMath::DegreesToRadians(25.))*Panel/Width;
        }
    }
    Camera->SetActorLocationAndRotation(ViewTarget+CameraOffset,Rotation);
}

void AVirtualWorldRuntime::HandleInput(float DeltaSeconds)
{
    APlayerController* PC=GetWorld()->GetFirstPlayerController();if(!PC)return;
    const auto Pressed=[PC](const FKey& Key){return PC->WasInputKeyJustPressed(Key);};
    if(Pressed(EKeys::O)) ChooseCadFile();
    if(Pressed(EKeys::E)) Command(TEXT("interact"));
    if(Pressed(EKeys::Escape)) {Dialogue.Empty();SelectedInteraction.Empty();}
    if(Pressed(EKeys::Tab)) Command(TEXT("next"));
    if(Pressed(EKeys::R)) Command(TEXT("reset"));
    if(Pressed(EKeys::P)) Command(TEXT("pause"));
    if(Pressed(EKeys::SpaceBar)) Command(TEXT("run"));
    if(Pressed(EKeys::LeftBracket)) Command(TEXT("step-back"));
    if(Pressed(EKeys::RightBracket)) Command(TEXT("step"));
    if(Pressed(EKeys::C)) Command(TEXT("section"));
    if(Pressed(EKeys::X)) Command(TEXT("explode"));
    if(Pressed(EKeys::M)) Command(TEXT("markers"));
    if(Pressed(EKeys::G)) Command(TEXT("principle"));
    if(Pressed(EKeys::K)) Command(TEXT("focus-brake"));
    if(Pressed(EKeys::V)) Command(TEXT("focus-principle"));
    if(Pressed(EKeys::H)) Command(TEXT("frame-assembly"));
    if(Pressed(EKeys::T)) Command(TEXT("slow-motion"));
    if(Pressed(EKeys::B)) Command(TEXT("brake-power"));
    if(Pressed(EKeys::I)) Command(TEXT("brake-install"));
    if(Pressed(EKeys::Equals)||Pressed(EKeys::Add)) Command(TEXT("speed-up"));
    if(Pressed(EKeys::Hyphen)||Pressed(EKeys::Subtract)) Command(TEXT("speed-down"));
    const FKey Digits[]={EKeys::One,EKeys::Two,EKeys::Three,EKeys::Four,EKeys::Five,EKeys::Six,EKeys::Seven,EKeys::Eight,EKeys::Nine,EKeys::Zero};
    for(int32 I=0;I<10;++I) if(Pressed(Digits[I])) Command(TEXT("choice:")+FString::FromInt(I));
    float DX=0,DY=0;
    if(PC->IsInputKeyDown(EKeys::RightMouseButton)) PC->GetInputMouseDelta(DX,DY);
    DX+=((PC->IsInputKeyDown(EKeys::Right)?1.f:0.f)-(PC->IsInputKeyDown(EKeys::Left)?1.f:0.f))*160.f*DeltaSeconds;
    DY+=((PC->IsInputKeyDown(EKeys::Down)?1.f:0.f)-(PC->IsInputKeyDown(EKeys::Up)?1.f:0.f))*160.f*DeltaSeconds;
    if(!FMath::IsNearlyZero(DX)||!FMath::IsNearlyZero(DY))
    {
        const FVector Right=FVector::CrossProduct(CameraUp,-CameraOffset.GetSafeNormal()).GetSafeNormal();
        const FQuat Rotation=FQuat(Right,-DY*.006f)*FQuat(CameraUp,-DX*.006f);
        CameraOffset=Rotation.RotateVector(CameraOffset);CameraUp=Rotation.RotateVector(CameraUp).GetSafeNormal();
    }
    if(Mechanism)
    {
        const float Roll=(PC->IsInputKeyDown(EKeys::Q)?1.f:0.f)-(PC->IsInputKeyDown(EKeys::F)?1.f:0.f);
        CameraUp=FQuat(-CameraOffset.GetSafeNormal(),Roll*DeltaSeconds).RotateVector(CameraUp);
    }
    float MouseX=0,MouseY=0;PC->GetMousePosition(MouseX,MouseY);
    if(MouseX>460.f)
    {
        const int Zoom=(Pressed(EKeys::MouseScrollUp)?-1:0)+(Pressed(EKeys::MouseScrollDown)?1:0);
        if(Zoom) CameraOffset=CameraOffset.GetSafeNormal()*FMath::Clamp(CameraOffset.Size()*FMath::Pow(1.15,Zoom),PlayerRoot?100.:InspectionZoomMin,PlayerRoot?5000.:InspectionZoomMax);
    }
}

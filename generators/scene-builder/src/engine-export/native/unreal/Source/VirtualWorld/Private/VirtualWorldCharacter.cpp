#include "VirtualWorldRuntime.h"
#include "VirtualWorldModel.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Engine/GameViewportClient.h"
#include "UnrealClient.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "CollisionQueryParams.h"
#include "CollisionShape.h"
#include "Components/SceneComponent.h"
#include "Components/PrimitiveComponent.h"

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
    PlayerVerticalSpeed=0;LastGroundedFeet=PlayerFeet;
    // A valid lower platform must remain reachable. Recover only below the complete physical world.
    double Lowest=PlayerFeet.Z;
    for(const auto& Pair:Nodes)
    {
        TArray<UPrimitiveComponent*> Primitives;
        if(Pair.Value.Model) Pair.Value.Model->GetComponents<UPrimitiveComponent>(Primitives);
        for(USceneComponent* Child:Pair.Value.Wrapper->GetAttachChildren())
            if(UPrimitiveComponent* Primitive=Cast<UPrimitiveComponent>(Child)) Primitives.Add(Primitive);
        for(UPrimitiveComponent* Primitive:Primitives)
            if(Primitive->GetCollisionEnabled()!=ECollisionEnabled::NoCollision) Lowest=FMath::Min(Lowest,Primitive->Bounds.GetBox().Min.Z);
    }
    PlayerRecoveryFloor=Lowest-PlayerHeight-10.;
    FHitResult Ground;
    bPlayerGrounded=ProbePlayerGround(Ground,10.f);
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
    const FVector Previous=PlayerFeet;
    StepPlayerMovement(Direction,PC->WasInputKeyJustPressed(EKeys::SpaceBar),DeltaSeconds);
    const bool bWalking=bPlayerGrounded&&FVector::VectorPlaneProject(PlayerFeet-Previous,PlayerUp).SizeSquared()>.01;
    PlayPlayerClip(InteractionRemaining>0?TEXT("interact"):(bWalking?TEXT("walk"):TEXT("idle")));
}

bool AVirtualWorldRuntime::ProbePlayerGround(FHitResult& Hit,float Distance) const
{
    const double HalfHeight=PlayerHeight*.5,Skin=FMath::Max(1.,PlayerHeight*.01);
    const FVector Start=PlayerFeet+PlayerUp*(HalfHeight+Skin);
    FCollisionQueryParams Params(SCENE_QUERY_STAT(VirtualWorldGround),true);
    if(PlayerModel) Params.AddIgnoredActor(PlayerModel);
    return GetWorld()->SweepSingleByChannel(Hit,Start,Start-PlayerUp*Distance,
        FQuat::FindBetweenNormals(FVector::UpVector,PlayerUp),ECC_Pawn,
        FCollisionShape::MakeCapsule(PlayerRadius,HalfHeight),Params)
        &&!Hit.bStartPenetrating&&FVector::DotProduct(Hit.ImpactNormal,PlayerUp)>.55;
}

void AVirtualWorldRuntime::StepPlayerMovement(const FVector& Direction,bool bJumpPressed,float DeltaSeconds)
{
    const double Delta=FMath::Clamp(static_cast<double>(DeltaSeconds),0.,.05);
    if(!PlayerRoot||Delta<=0) return;
    const VW::Json Navigation=VW::Object(Metadata,TEXT("navigation"));
    const bool bSphere=VW::String(Navigation,TEXT("kind"))==TEXT("sphere");
    const FVector Centre=VW::Position(VW::Vector(Navigation,TEXT("center")));
    const double Radius=VW::Number(Navigation,TEXT("radius"))*100.;
    const double HalfHeight=PlayerHeight*.5,Skin=FMath::Max(1.,PlayerHeight*.01);
    const VW::Json Bounds=VW::Object(Navigation,TEXT("bounds"));
    const FVector OldUp=PlayerUp;
    if(bSphere) PlayerUp=(PlayerFeet-Centre).GetSafeNormal(SMALL_NUMBER,OldUp);

    FHitResult Ground;
    bPlayerGrounded=PlayerVerticalSpeed<=0&&ProbePlayerGround(Ground,static_cast<float>(Skin+6.));
    if(bPlayerGrounded) PlayerFeet=Ground.Location-PlayerUp*HalfHeight;
    if(bSphere&&FVector::Dist(PlayerFeet,Centre)<=Radius+.1&&PlayerVerticalSpeed<=0)
    {
        PlayerFeet=Centre+PlayerUp*Radius;bPlayerGrounded=true;
    }
    const VW::VerticalMotion Vertical=VW::StepVerticalMotion(PlayerVerticalSpeed,bPlayerGrounded,bJumpPressed,Delta);
    PlayerVerticalSpeed=Vertical.Speed;
    if(bJumpPressed&&bPlayerGrounded) bPlayerGrounded=false;
    const FVector Tangent=FVector::VectorPlaneProject(Direction,PlayerUp).GetClampedToMaxSize(1.);
    const FVector Proposed=bSphere?VW::SphericalPlayerStep(PlayerFeet,Centre,Tangent*260.*Delta,Vertical.Distance)
        :VW::ConstrainPlanePosition(PlayerFeet+Tangent*260.*Delta+PlayerUp*Vertical.Distance,Bounds,PlayerRadius+Skin);
    const FVector ProposedUp=bSphere?(Proposed-Centre).GetSafeNormal(SMALL_NUMBER,PlayerUp):PlayerUp;
    const FQuat Orientation=FQuat::FindBetweenNormals(FVector::UpVector,(PlayerUp+ProposedUp).GetSafeNormal(SMALL_NUMBER,PlayerUp));
    const FCollisionShape Shape=FCollisionShape::MakeCapsule(PlayerRadius,HalfHeight);
    FCollisionQueryParams Params(SCENE_QUERY_STAT(VirtualWorldMove),true);
    if(PlayerModel) Params.AddIgnoredActor(PlayerModel);
    FVector Accepted=PlayerFeet+PlayerUp*(HalfHeight+Skin);
    FVector Remaining=Proposed+ProposedUp*(HalfHeight+Skin)-Accepted;
    for(int32 Iteration=0;Iteration<4&&!Remaining.IsNearlyZero(.0001);++Iteration)
    {
        FHitResult Hit;
        if(!GetWorld()->SweepSingleByChannel(Hit,Accepted,Accepted+Remaining,Orientation,ECC_Pawn,Shape,Params))
        {
            Accepted+=Remaining;break;
        }
        const double NormalUp=FVector::DotProduct(Hit.Normal,PlayerUp);
        if(NormalUp>.55&&PlayerVerticalSpeed<0) {PlayerVerticalSpeed=0;bPlayerGrounded=true;}
        if(NormalUp<-.55&&PlayerVerticalSpeed>0) PlayerVerticalSpeed=0;
        if(Hit.bStartPenetrating)
        {
            // Spawn on a slope or touching two proxies may need a native penetration correction.
            Accepted+=Hit.Normal.GetSafeNormal(SMALL_NUMBER,PlayerUp)*(Hit.PenetrationDepth+Skin);
            continue;
        }
        const double Length=Remaining.Size();
        const double Fraction=FMath::Clamp(static_cast<double>(Hit.Time)-Skin/Length,0.,1.);
        Accepted+=Remaining*Fraction;
        Remaining=FVector::VectorPlaneProject(Remaining*(1-Fraction),Hit.Normal);
    }
    PlayerUp=bSphere?(Accepted-Centre).GetSafeNormal(SMALL_NUMBER,OldUp):FVector::UpVector;
    PlayerFeet=Accepted-PlayerUp*(HalfHeight+Skin);
    if(!bSphere) PlayerFeet=VW::ConstrainPlanePosition(PlayerFeet,Bounds,PlayerRadius+Skin);
    if(PlayerVerticalSpeed<=0&&ProbePlayerGround(Ground,static_cast<float>(Skin+6.)))
    {
        PlayerFeet=Ground.Location-PlayerUp*HalfHeight;PlayerVerticalSpeed=0;bPlayerGrounded=true;
    }
    else bPlayerGrounded=false;
    if(bSphere)
    {
        const double Altitude=FVector::Dist(PlayerFeet,Centre);
        if(Altitude<Radius)
        {
            PlayerFeet=Centre+PlayerUp*Radius;
            if(PlayerVerticalSpeed<=0) {PlayerVerticalSpeed=0;bPlayerGrounded=true;}
        }
        if(Altitude>Radius+3000.) {PlayerFeet=LastGroundedFeet;PlayerVerticalSpeed=0;bPlayerGrounded=false;}
        PlayerUp=(PlayerFeet-Centre).GetSafeNormal(SMALL_NUMBER,OldUp);
    }
    else if(PlayerFeet.Z<PlayerRecoveryFloor)
    {
        PlayerFeet=LastGroundedFeet;PlayerVerticalSpeed=0;bPlayerGrounded=false;
    }
    if(bPlayerGrounded) LastGroundedFeet=PlayerFeet;
    const FQuat Transport=FQuat::FindBetweenNormals(OldUp,PlayerUp);
    const FVector Heading=Transport.RotateVector(Tangent.IsNearlyZero()?PlayerForward:Tangent);
    PlayerForward=FVector::VectorPlaneProject(Heading,PlayerUp).GetSafeNormal(SMALL_NUMBER,PlayerForward);
    if(bSphere) {CameraOffset=Transport.RotateVector(CameraOffset);CameraUp=Transport.RotateVector(CameraUp).GetSafeNormal();}
    PlayerRoot->SetWorldLocationAndRotation(PlayerFeet,FRotationMatrix::MakeFromXZ(PlayerForward,PlayerUp).ToQuat());
}

void AVirtualWorldRuntime::ResetCamera()
{
    PointerDrag.Reset();
    bLastPointerValid=bPointerOrbit=bPointerPan=bRightWasDown=bMiddleWasDown=false;PendingPanelWheel=0;
    if(bImportedModule)
    {
        FitImportedCamera();InspectionZoomMin=.001f;InspectionZoomMax=1.e8f;return;
    }
    const VW::Json SourceCamera=VW::Object(Scene,TEXT("camera"));
    CameraTarget=VW::Position(VW::Vector(SourceCamera,TEXT("target")));
    CameraOffset=VW::Position(VW::Vector(SourceCamera,TEXT("position")))-CameraTarget;
    if(CameraOffset.IsNearlyZero()) CameraOffset=FVector(300,300,200);
    CameraUp=PlayerRoot?PlayerUp:FVector::UpVector;
    const VW::Json Navigation=VW::Object(Metadata,TEXT("navigation"));
    if(PlayerRoot&&VW::String(Navigation,TEXT("kind"))==TEXT("sphere"))
    {
        const FVector Centre=VW::Position(VW::Vector(Navigation,TEXT("center")));
        const FVector SpawnUp=(VW::Position(VW::Vector(Scene,TEXT("spawn")))-Centre).GetSafeNormal(SMALL_NUMBER,FVector::UpVector);
        CameraOffset=FQuat::FindBetweenNormals(SpawnUp,PlayerUp).RotateVector(CameraOffset);
    }
    InspectionZoomMin=FMath::Max(.02f,static_cast<float>(CameraOffset.Size()*.015));
    InspectionZoomMax=FMath::Max(InspectionZoomMin*2,static_cast<float>(CameraOffset.Size()*50));
    UpdateCamera();
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
    if(Pressed(EKeys::SpaceBar)&&Mechanism) Command(TEXT("run"));
    if(Pressed(EKeys::Home)) Command(TEXT("camera-reset"));
    if(Pressed(EKeys::F9)) Command(TEXT("screenshot"));
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
    float MX=0,MY=0,RawX=0,RawY=0;const bool HasPosition=PC->GetMousePosition(MX,MY);
    PC->GetInputMouseDelta(RawX,RawY);int32 Width=0,Height=0;PC->GetViewportSize(Width,Height);
    double Wheel=PC->GetInputAnalogKeyState(EKeys::MouseWheelAxis);
    if(!FMath::IsFinite(Wheel)||FMath::IsNearlyZero(Wheel))Wheel=(Pressed(EKeys::MouseScrollUp)?1:0)-(Pressed(EKeys::MouseScrollDown)?1:0);
    const UGameViewportClient* ViewportClient=GetWorld()->GetGameViewport();
    const bool Focused=ViewportClient&&ViewportClient->Viewport&&ViewportClient->Viewport->HasFocus();
    UpdateInspectionPointer(FVector2D(MX,MY),HasPosition,FVector2D(RawX,RawY),PC->IsInputKeyDown(EKeys::RightMouseButton),PC->IsInputKeyDown(EKeys::MiddleMouseButton),Wheel,Width,Height,PC->IsInputKeyDown(EKeys::LeftMouseButton),Focused);
    const float DX=((PC->IsInputKeyDown(EKeys::Right)?1.f:0.f)-(PC->IsInputKeyDown(EKeys::Left)?1.f:0.f))*160.f*DeltaSeconds;
    const float DY=((PC->IsInputKeyDown(EKeys::Down)?1.f:0.f)-(PC->IsInputKeyDown(EKeys::Up)?1.f:0.f))*160.f*DeltaSeconds;
    if(!FMath::IsNearlyZero(DX)||!FMath::IsNearlyZero(DY))
    {
        const FVector Right=FVector::CrossProduct(CameraUp,-CameraOffset.GetSafeNormal()).GetSafeNormal();
        const FQuat Rotation=FQuat(Right,-DY*.006f)*FQuat(CameraUp,-DX*.006f);
        CameraOffset=Rotation.RotateVector(CameraOffset);CameraUp=Rotation.RotateVector(CameraUp).GetSafeNormal();
    }
    if(IsModuleViewer())
    {
        const float Roll=(PC->IsInputKeyDown(EKeys::Q)?1.f:0.f)-(PC->IsInputKeyDown(EKeys::F)?1.f:0.f);
        CameraUp=FQuat(-CameraOffset.GetSafeNormal(),Roll*DeltaSeconds).RotateVector(CameraUp);
    }
 }

void AVirtualWorldRuntime::UpdateInspectionPointer(FVector2D Position,bool HasPosition,FVector2D RawDelta,bool RightDown,bool MiddleDown,double Wheel,int32 Width,int32 Height,bool LeftDown,bool Focused)
{
    const bool OrbitDown=RightDown||(IsModuleViewer()&&LeftDown);
    if(Width<=0||Height<=0||!Focused)
    {
        bLastPointerValid=bPointerOrbit=bPointerPan=false;
        bRightWasDown=OrbitDown;bMiddleWasDown=MiddleDown;return;
    }
    HasPosition=HasPosition&&FMath::IsFinite(Position.X)&&FMath::IsFinite(Position.Y)&&Position.X>=0&&Position.X<Width&&Position.Y>=0&&Position.Y<Height;
    const double Panel=VW::ControlPanelWidth(Width);
    const bool InScene=HasPosition&&Position.X>=Panel&&Position.X<Width&&Position.Y>=0&&Position.Y<Height;
    const bool Continuing=(bPointerOrbit&&OrbitDown)||(bPointerPan&&MiddleDown);
    if(!OrbitDown)bPointerOrbit=false;if(!MiddleDown)bPointerPan=false;
    if(!bPointerOrbit&&!bPointerPan&&InScene){bPointerOrbit=OrbitDown&&!bRightWasDown;bPointerPan=MiddleDown&&!bMiddleWasDown&&!OrbitDown&&!PlayerRoot;}
    // Unreal MouseY is positive upward; absolute cursor positions are positive downward.
    FVector2D Delta(RawDelta.X,-RawDelta.Y);
    if(Delta.IsNearlyZero()&&HasPosition&&bLastPointerValid)Delta=Position-LastPointerPosition;
    if(Continuing&&!Delta.ContainsNaN())
    {
        const FVector Right=FVector::CrossProduct(CameraUp,-CameraOffset.GetSafeNormal()).GetSafeNormal();
        if(bPointerOrbit)
        {
            const FQuat Rotation=FQuat(Right,-Delta.Y*.006)*FQuat(CameraUp,-Delta.X*.006);
            CameraOffset=Rotation.RotateVector(CameraOffset);CameraUp=Rotation.RotateVector(CameraUp).GetSafeNormal();
        }
        else if(bPointerPan)
        {
            // World distance per viewport pixel at the inspection target, preserving camera roll.
            const double Fov=Camera?Camera->GetCameraComponent()->FieldOfView:50.;
            CameraTarget+=VW::PointerPan(CameraOffset,CameraUp,Delta,Width,Fov);
        }
    }
    if(HasPosition&&FMath::IsFinite(Wheel)&&Wheel!=0)
    {
        if(InScene)CameraOffset=CameraOffset.GetSafeNormal()*FMath::Clamp(CameraOffset.Size()*FMath::Pow(1.12,-Wheel),PlayerRoot?100.:(bImportedModule?.001:InspectionZoomMin),PlayerRoot?5000.:(bImportedModule?1.e8:InspectionZoomMax));
        else if(Position.X>=0&&Position.X<Panel)PendingPanelWheel+=Wheel;
    }
    bRightWasDown=OrbitDown;bMiddleWasDown=MiddleDown;
    bLastPointerValid=HasPosition;if(HasPosition)LastPointerPosition=Position;
}

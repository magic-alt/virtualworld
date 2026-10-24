#include "VirtualWorldRuntime.h"
#include "VirtualWorldModel.h"
#include "Components/StaticMeshComponent.h"
#include "ProceduralMeshComponent.h"
#include "KismetProceduralMeshLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/StaticMesh.h"
#include "StaticMeshResources.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/PlayerController.h"

bool AVirtualWorldRuntime::BindCadJoint()
{
    FVirtualWorldNode* ModelNode=Nodes.Find(VW::String(Mechanism,TEXT("modelNodeId")));
    if(!ModelNode||!ModelNode->Model) return Fail(TEXT("CAD joint model node is unavailable."));
    const FString ModelId=VW::String(ModelNode->Native,TEXT("model"));
    const VW::Json* Record=ModelRecords.Find(ModelId);
    const FString Source=VW::String(Mechanism,TEXT("sourceSha256"));
    bool Hex=Source.Len()==64;for(TCHAR C:Source) Hex&=(C>='0'&&C<='9')||(C>='a'&&C<='f');
    if(!Hex||!Record||VW::String(*Record,TEXT("sha256"))!=VW::String(Mechanism,TEXT("modelSha256")))
        return Fail(TEXT("CAD motion rejected: source provenance or immutable model SHA-256 mismatch."));
    // SpawnModel already verified the actual canonical GLB bytes against this same record.
    const VW::Json Config=VW::Object(Mechanism,TEXT("dynamics"));
    VWJoint::Config C;
#define VW_JOINT_READ(Name) if(!Config||!Config->TryGetNumberField(TEXT(#Name),C.Name)) return Fail(TEXT("Missing joint dynamics field: " #Name));
    VW_JOINT_READ(inertia);VW_JOINT_READ(driveTorque);VW_JOINT_READ(brakeTorque);VW_JOINT_READ(holdTorque);VW_JOINT_READ(viscousDrag);
    VW_JOINT_READ(engageDelay);VW_JOINT_READ(engageRamp);VW_JOINT_READ(releaseDelay);VW_JOINT_READ(releaseRamp);VW_JOINT_READ(armatureTravel);
#undef VW_JOINT_READ
    if(!C.valid()||VW::String(Config,TEXT("provenance"))!=TEXT("demonstration-assumption")) return Fail(TEXT("Invalid or unlabelled SI joint assumptions."));
    CadModelRoot=ModelNode->Model->GetRootComponent();
    TArray<UPrimitiveComponent*> Components;ModelNode->Model->GetComponents<UPrimitiveComponent>(Components);
    TSet<int32> Seen;
    for(const auto& Value:VW::Array(Mechanism,TEXT("bindings")))
    {
        const VW::Json Binding=Value->AsObject();const double Index=VW::Number(Binding,TEXT("gltfNodeIndex"),-1);
        if(!FMath::IsFinite(Index)||Index<0||Index>MAX_int32||Index!=FMath::FloorToDouble(Index)||Seen.Contains(static_cast<int32>(Index))) return Fail(TEXT("Invalid or duplicate CAD node index."));
        Seen.Add(static_cast<int32>(Index));
        const FName Tag(*FString::Printf(TEXT("glTFRuntime:NodeIndex:%d"),static_cast<int32>(Index)));
        TArray<UPrimitiveComponent*> Matches;for(auto* Component:Components) if(Component->ComponentHasTag(Tag)) Matches.Add(Component);
        if(Matches.IsEmpty()) return Fail(TEXT("CAD binding does not resolve to a real mesh component: ")+Tag.ToString());
        const FString Role=VW::String(Binding,TEXT("role"));
        if(VW::Array(Binding,TEXT("pivot")).Num()!=3||VW::Vector(Binding,TEXT("pivot")).ContainsNaN()||VW::Vector(Binding,TEXT("center")).ContainsNaN())return Fail(TEXT("Invalid CAD SI pivot/center."));
        if(!VW::Vector(Binding,TEXT("axis")).IsUnit(1e-6)) return Fail(TEXT("CAD axis must have unit length."));
        if(Role==TEXT("ball")&&VW::Array(Binding,TEXT("center")).Num()!=3) return Fail(TEXT("A ball requires its measured center; motion was not guessed."));
        if(Role==TEXT("ball")||Role==TEXT("inner-race")||Role==TEXT("outer-race"))
        {
            bool Found=false;
            for(const auto& B:VW::Array(Mechanism,TEXT("bearings"))) if(VW::String(B->AsObject(),TEXT("id"))==VW::String(Binding,TEXT("bearingId")))
            {Found=true;if(VW::Number(B->AsObject(),TEXT("ballRadius"))<=0||VW::Number(B->AsObject(),TEXT("pitchRadius"))<=VW::Number(B->AsObject(),TEXT("ballRadius"))) return Fail(TEXT("Invalid radial bearing geometry."));}
            if(!Found) return Fail(TEXT("CAD bearing role has no bearing configuration."));
        }
        for(auto* Component:Matches)
        {
            FVirtualWorldCadBinding Entry;Entry.Data=Binding;Entry.Component=Component;Entry.bOriginalVisible=Component->IsVisible();
            Entry.Original=Component->GetComponentTransform().GetRelativeTransform(CadModelRoot->GetComponentTransform());
            Component->SetMobility(EComponentMobility::Movable);CadBindings.Add(Entry);
        }
    }
    // A bound parent may move before an unbound child. Restore all unknown originals after parents.
    for(auto* Component:Components)
    {
        bool Bound=false;for(const auto& Entry:CadBindings)Bound|=Entry.Component==Component;
        if(!Bound){FVirtualWorldCadBinding Entry;Entry.Component=Component;Entry.bOriginalVisible=Component->IsVisible();Entry.Data=MakeShared<FJsonObject>();Entry.Data->SetStringField(TEXT("role"),TEXT("unknown"));Entry.Original=Component->GetComponentTransform().GetRelativeTransform(CadModelRoot->GetComponentTransform());CadBindings.Add(Entry);Component->SetMobility(EComponentMobility::Movable);}
    }
    CadBindings.Sort([](const FVirtualWorldCadBinding& A,const FVirtualWorldCadBinding& B){const auto Depth=[](USceneComponent* Component){int32 N=0;for(;Component;Component=Component->GetAttachParent())++N;return N;};return Depth(A.Component)<Depth(B.Component);});
    const auto P=VW::Object(Mechanism,TEXT("principle"));
    if(P)
    {
        const double Nf=VW::Number(P,TEXT("flexTeeth")),Nc=VW::Number(P,TEXT("ringTeeth")),Radius=VW::Number(P,TEXT("radius")),Amplitude=VW::Number(P,TEXT("amplitude")),Height=VW::Number(P,TEXT("toothHeight")),Clearance=VW::Number(P,TEXT("clearance"));
        for(double Value:{Nf,Nc,Radius,Amplitude,Height,Clearance})if(!FMath::IsFinite(Value))return Fail(TEXT("Nonfinite principle geometry."));
        if(Nf<10||Nc!=Nf+2||Radius<=0||Amplitude<=0||Amplitude>=Radius/4||Height<=0||Height>=Amplitude/2||Clearance<0)return Fail(TEXT("Invalid illustrative two-wave profile."));
    }
    const auto Gear=VW::Object(Mechanism,TEXT("gear"));
    const FString GearStatus=VW::String(Gear,TEXT("status"));
    if(GearStatus==TEXT("user-specified"))
    {
        const double Ratio=VW::Number(Gear,TEXT("reductionRatio"));const FString Fixed=VW::String(Gear,TEXT("fixedMember"));
        if(!FMath::IsFinite(Ratio)||Ratio<=0||(Fixed!=TEXT("flexspline")&&Fixed!=TEXT("circular-spline"))||VW::String(Gear,TEXT("evidence")).IsEmpty())return Fail(TEXT("Invalid stated CAD transmission or missing provenance."));
    }
    else if(GearStatus==TEXT("evidenced"))
    {
        const double Nf=VW::Number(Gear,TEXT("flexTeeth")),Nc=VW::Number(Gear,TEXT("ringTeeth"));
        if(!FMath::IsFinite(Nf)||!FMath::IsFinite(Nc)||Nf<=0||Nc<=Nf||!VW::Bool(Gear,TEXT("fixedRing")))return Fail(TEXT("Invalid legacy evidenced fixed-ring transmission."));
    }
    JointDynamics=MakeUnique<VWJoint::Dynamics>(C);JointDynamics->setRpm(Rpm);
    bHasBrake=bBrakeInstalled=bBrakePowered=true;
    // Optional child markers leave every imported material unchanged.
    UStaticMesh* Sphere=LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    UMaterialInterface* MarkerMaterial=LoadObject<UMaterialInterface>(nullptr,TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
    for(auto& Entry:CadBindings)
    {
        const FString Role=VW::String(Entry.Data,TEXT("role"));const auto Factors=CadTransmission();
        const bool Ball=Role==TEXT("ball"),Input=Role==TEXT("input"),Output=Role==TEXT("output")||(Role==TEXT("flexspline")&&Factors.flex!=0)||(Role==TEXT("circular-spline")&&Factors.circular!=0);
        if(!Ball&&!Input&&!Output)continue;
        double Radius=0;FVector Surface;
        const FVector Axis=VW::Vector(Entry.Data,TEXT("axis")),Pivot=VW::Vector(Entry.Data,TEXT("pivot"));
        FVector Radial=Ball?VW::Vector(Entry.Data,TEXT("center"))-Pivot:FVector(1,0,0);
        Radial=(Radial-Axis*FVector::DotProduct(Radial,Axis)).GetSafeNormal();
        if(Radial.IsNearlyZero())Radial=FVector::CrossProduct(Axis,FVector(0,1,0)).GetSafeNormal();
        if(Ball)
        {
            for(const auto& B:VW::Array(Mechanism,TEXT("bearings")))if(VW::String(B->AsObject(),TEXT("id"))==VW::String(Entry.Data,TEXT("bearingId")))Radius=VW::Number(B->AsObject(),TEXT("ballRadius"));
            Surface=VW::Vector(Entry.Data,TEXT("center"))+Radial*Radius;
        }
        else
        {
            // Pick an actual final-GLB surface vertex. World AABBs inflate under model rotation.
            double Furthest=-TNumericLimits<double>::Max();bool Found=false;
            if(const auto* Static=Cast<UStaticMeshComponent>(Entry.Component))if(const auto* Mesh=Static->GetStaticMesh())if(const auto* Render=Mesh->GetRenderData())if(!Render->LODResources.IsEmpty())
            {
                const auto& Positions=Render->LODResources[0].VertexBuffers.PositionVertexBuffer;
                for(uint32 I=0;I<Positions.GetNumVertices();++I)
                {
                    const FVector Point=VW::SourcePosition(Entry.Original.TransformPosition(FVector(Positions.VertexPosition(I))));
                    const double Projection=FVector::DotProduct(Point-Pivot,Radial);
                    if(Projection>Furthest){Furthest=Projection;Surface=Point;Found=true;}
                }
            }
            if(!Found)continue;
            const FVector Delta=Surface-Pivot;Radius=FMath::Max(.001,(Delta-Axis*FVector::DotProduct(Delta,Axis)).Size());Surface+=Radial*.00015;
        }
        auto* Marker=NewObject<UStaticMeshComponent>(this);AddInstanceComponent(Marker);Marker->SetStaticMesh(Sphere);Marker->SetCollisionEnabled(ECollisionEnabled::NoCollision);Marker->RegisterComponent();SceneComponents.Add(Marker);
        Marker->SetWorldLocation(CadModelRoot->GetComponentTransform().TransformPosition(VW::Position(Surface)));Marker->SetWorldScale3D(FVector((Ball?Radius*.12:FMath::Max(.0005,Radius*.045))*100/50));
        Marker->AttachToComponent(Entry.Component,FAttachmentTransformRules::KeepWorldTransform);Marker->SetVisibility(false);
        if(MarkerMaterial){auto* M=UMaterialInstanceDynamic::Create(MarkerMaterial,this);M->SetVectorParameterValue(TEXT("Color"),Output?FLinearColor(.02,.35,1):FLinearColor(1,.22,.015));Marker->SetMaterial(0,M);}
        Entry.Marker=Marker;
    }
    BuildCadPrinciple();return true;
}

VWJoint::Transmission AVirtualWorldRuntime::CadTransmission() const
{
    const auto Gear=VW::Object(Mechanism,TEXT("gear"));const FString Status=VW::String(Gear,TEXT("status"));
    if(Status==TEXT("user-specified"))return VWJoint::statedTransmission(VW::Number(Gear,TEXT("reductionRatio")),VW::String(Gear,TEXT("fixedMember"))==TEXT("flexspline"));
    if(Status==TEXT("evidenced")&&VW::Bool(Gear,TEXT("fixedRing")))return VWJoint::toothTransmission(VW::Number(Gear,TEXT("flexTeeth")),VW::Number(Gear,TEXT("ringTeeth")),false);
    return {};
}

void AVirtualWorldRuntime::ApplyCadJoint()
{
    if(!JointDynamics||!CadModelRoot)return;
    const auto State=JointDynamics->snapshot();InputAngle=State.angle+KinematicOffset;const auto Factors=CadTransmission();
    for(auto& Entry:CadBindings)
    {
        const auto& B=Entry.Data;const FString Role=VW::String(B,TEXT("role"));const FVector Pivot=VW::Vector(B,TEXT("pivot")),Axis=VW::Vector(B,TEXT("axis"));
        double Angle=0;FVector Translation=FVector::ZeroVector;FQuat Rotation=FQuat::Identity;
        VW::Json Bearing;for(const auto& Value:VW::Array(Mechanism,TEXT("bearings")))if(VW::String(Value->AsObject(),TEXT("id"))==VW::String(B,TEXT("bearingId")))Bearing=Value->AsObject();
        if(Role==TEXT("input"))Angle=InputAngle;
        else if(Role==TEXT("output"))Angle=InputAngle*Factors.output;
        else if(Role==TEXT("flexspline"))Angle=InputAngle*Factors.flex;
        else if(Role==TEXT("circular-spline"))Angle=InputAngle*Factors.circular;
        else if(Role==TEXT("inner-race"))Angle=InputAngle*VW::Number(Bearing,TEXT("innerSpeedFactor"));
        else if(Role==TEXT("outer-race"))Angle=InputAngle*VW::Number(Bearing,TEXT("outerSpeedFactor"));
        else if(Role==TEXT("armature"))Translation=Axis*State.closure*JointDynamics->config.armatureTravel;
        if(Role==TEXT("ball"))
        {
            const auto Rolling=VWJoint::rollingState(InputAngle*VW::Number(Bearing,TEXT("innerSpeedFactor")),InputAngle*VW::Number(Bearing,TEXT("outerSpeedFactor")),VW::Number(Bearing,TEXT("pitchRadius")),VW::Number(Bearing,TEXT("ballRadius")));
            const FVector Center=VW::Vector(B,TEXT("center"));const FQuat Orbit(Axis,Rolling.cageAngle);Rotation=FQuat(Axis,Rolling.worldBallAngle);
            Translation=Pivot+Orbit.RotateVector(Center-Pivot)-Rotation.RotateVector(Center);
        }
        else if(Angle!=0){Rotation=FQuat(Axis,Angle);Translation=Pivot-Rotation.RotateVector(Pivot);}
        const FTransform Motion=VW::Transform(Translation,Rotation,FVector::OneVector);
        // All vertices retain their original model frame. Rotate about fitted pivots, not mesh origins.
        Entry.Component->SetWorldTransform(Entry.Original*Motion*CadModelRoot->GetComponentTransform());
    }
    UpdateCadSections();UpdateCadPrinciple();
}

void AVirtualWorldRuntime::ReleaseCadSections()
{
    for(auto& Entry:CadBindings)
    {
        if(Entry.InspectionMesh){SceneComponents.Remove(Entry.InspectionMesh);Entry.InspectionMesh->DestroyComponent();Entry.InspectionMesh=nullptr;}
        Entry.bInspectionBuilt=false;
    }
}

void AVirtualWorldRuntime::UpdateCadSections()
{
    if(!bSection){ReleaseCadSections();return;}
    if(!CadModelRoot)return;
    const FTransform ModelWorld=CadModelRoot->GetComponentTransform();
    const FVector PlanePosition=ModelWorld.TransformPosition(FVector::ZeroVector);
    // Slice keeps the positive normal side: use CAD -X to retain CAD x<=0.
    // Inverse transpose, so a nonuniform model scale also preserves this fixed plane.
    const FVector PlaneNormal=ModelWorld.GetRotation().RotateVector(VW::Position(FVector(-1,0,0)).GetSafeNormal()/ModelWorld.GetScale3D()).GetSafeNormal();
    for(auto& Entry:CadBindings)
    {
        if(!VW::Bool(Entry.Data,TEXT("inspectionCut"))||VW::Bool(Entry.Data,TEXT("inspectionHidden")))continue;
        auto* Source=Cast<UStaticMeshComponent>(Entry.Component);if(!Source||!Source->GetStaticMesh())continue;
        auto* Mesh=Source->GetStaticMesh();const auto* RenderData=Mesh->GetRenderData();
        if(!RenderData||RenderData->LODResources.IsEmpty()||RenderData->LODResources[0].VertexBuffers.PositionVertexBuffer.GetNumVertices()==0)
        {Notice=TEXT("Inspection warning: a selected mesh has no CPU LOD0 geometry; its original remains visible.");continue;}
        const FTransform Pose=Source->GetComponentTransform().GetRelativeTransform(ModelWorld);
        if(Entry.bInspectionBuilt&&Entry.InspectionPose.Equals(Pose,1e-9))continue;
        if(!Entry.InspectionMesh)
        {
            auto* Cut=NewObject<UProceduralMeshComponent>(this);AddInstanceComponent(Cut);Cut->SetupAttachment(CadModelRoot);Cut->RegisterComponent();SceneComponents.Add(Cut);Cut->SetCollisionEnabled(ECollisionEnabled::NoCollision);Entry.InspectionMesh=Cut;
            if(auto* Base=LoadObject<UMaterialInterface>(nullptr,TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial")))
            {auto* Cap=UMaterialInstanceDynamic::Create(Base,this);Cap->SetVectorParameterValue(TEXT("Color"),FLinearColor(.75,.42,.15));Cut->SetMaterial(Mesh->GetNumSections(0),Cap);}
        }
        auto* Cut=Entry.InspectionMesh;auto* Cap=Cut->GetMaterial(Mesh->GetNumSections(0));
        Cut->SetWorldTransform(Source->GetComponentTransform());Cut->ClearAllMeshSections();
        UKismetProceduralMeshLibrary::CopyProceduralMeshFromStaticMeshComponent(Source,0,Cut,false);
        UProceduralMeshComponent* Other=nullptr;
        // Engine cap triangulation closes supported manifold loops. This is display geometry only.
        UKismetProceduralMeshLibrary::SliceProceduralMesh(Cut,PlanePosition,PlaneNormal,false,Other,EProcMeshSliceCapOption::CreateNewSectionForCap,Cap);
        Entry.InspectionPose=Pose;Entry.bInspectionBuilt=true;++Entry.InspectionRevision;
    }
}

void AVirtualWorldRuntime::SelectCadSectionCamera()
{
    if(!CadModelRoot)return;
    const auto Model=CadModelRoot->GetComponentTransform();
    CameraOffset=Model.TransformVectorNoScale(VW::Position(FVector(1,.2,.1))).GetSafeNormal()*FMath::Max(1.,CameraOffset.Size());
    CameraUp=Model.TransformVectorNoScale(VW::Position(FVector(0,0,1))).GetSafeNormal();
    FrameCadInspection();
}

void AVirtualWorldRuntime::BuildCadPrinciple()
{
    const VW::Json P=VW::Object(Mechanism,TEXT("principle"));if(!P)return;
    PrincipleMesh=NewObject<UProceduralMeshComponent>(this);AddInstanceComponent(PrincipleMesh);PrincipleMesh->SetupAttachment(RootComponent);PrincipleMesh->RegisterComponent();SceneComponents.Add(PrincipleMesh);
    PrincipleMesh->SetRelativeLocation(VW::Position(VW::Vector(P,TEXT("position"))));PrincipleMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    UMaterialInterface* Base=LoadObject<UMaterialInterface>(nullptr,TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
    for(int I=0;I<2;++I)if(Base){auto* M=UMaterialInstanceDynamic::Create(Base,this);M->SetVectorParameterValue(TEXT("Color"),I==0?FLinearColor(.1,.55,.95):FLinearColor(.95,.6,.12));PrincipleMesh->SetMaterial(I,M);}
    auto* Armature=NewObject<UStaticMeshComponent>(this);AddInstanceComponent(Armature);Armature->SetStaticMesh(LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Cylinder.Cylinder")));Armature->SetupAttachment(PrincipleMesh);Armature->RegisterComponent();SceneComponents.Add(Armature);Armature->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Armature->SetRelativeTransform(FTransform(FRotationMatrix::MakeFromZ(VW::Position(FVector(0,0,1)).GetSafeNormal()).ToQuat(),VW::Position(FVector(0,-VW::Number(P,TEXT("radius"))*1.7,0)),FVector(.012,.012,.0004)));PrincipleArmature=Armature;
    if(Base){auto* M=UMaterialInstanceDynamic::Create(Base,this);M->SetVectorParameterValue(TEXT("Color"),FLinearColor(.95,.6,.12));Armature->SetMaterial(0,M);}
    auto* Pole=NewObject<UStaticMeshComponent>(this);AddInstanceComponent(Pole);Pole->SetStaticMesh(Armature->GetStaticMesh());Pole->SetupAttachment(PrincipleMesh);Pole->RegisterComponent();SceneComponents.Add(Pole);Pole->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    // Both disks are 0.4 mm thick. At closure=1 their opposing faces touch; at zero closure the air gap is exactly armatureTravel.
    Pole->SetRelativeTransform(FTransform(FRotationMatrix::MakeFromZ(VW::Position(FVector(0,0,1)).GetSafeNormal()).ToQuat(),VW::Position(FVector(0,-VW::Number(P,TEXT("radius"))*1.7,JointDynamics->config.armatureTravel+.0004)),FVector(.012,.012,.0004)));PrincipleBrakePole=Pole;
    if(Base){auto* M=UMaterialInstanceDynamic::Create(Base,this);M->SetVectorParameterValue(TEXT("Color"),FLinearColor(.2,.35,.5));Pole->SetMaterial(0,M);}
    UpdateCadPrinciple();PrincipleMesh->SetVisibility(false,true);
}

void AVirtualWorldRuntime::UpdateCadPrinciple()
{
    if(!PrincipleMesh)return;
    const VW::Json P=VW::Object(Mechanism,TEXT("principle"));
    const double R=VW::Number(P,TEXT("radius")),A=VW::Number(P,TEXT("amplitude")),H=VW::Number(P,TEXT("toothHeight")),Clearance=VW::Number(P,TEXT("clearance"));
    const double Nf=VW::Number(P,TEXT("flexTeeth")),Nc=VW::Number(P,TEXT("ringTeeth")),ThetaW=InputAngle;
    const auto Factors=VWJoint::toothTransmission(Nf,Nc,VW::String(P,TEXT("fixedMember"))==TEXT("flexspline"));
    const double ThetaF=Factors.flex*ThetaW,ThetaC=Factors.circular*ThetaW;
    // Solve transport in material coordinates. Teeth move tangentially as the two engagement zones travel.
    const auto Flex=[&](double Phi){const double U=Phi-ThetaF+(Nc-Nf)/(2*Nf)*FMath::Sin(2*(Phi-ThetaW));return R+A*FMath::Cos(2*(Phi-ThetaW))+H*FMath::Cos(Nf*U);};
    const auto Ring=[&](double Phi){return R+A+Clearance+H*FMath::Cos(Nc*(Phi-ThetaC));};
    PrincipleMinGap=TNumericLimits<double>::Max();
    for(int I=0;I<8192;++I){const double Phi=2*PI*I/8192;PrincipleMinGap=FMath::Min(PrincipleMinGap,Ring(Phi)-Flex(Phi));}
    constexpr int Samples=1536;
    for(int Strip=0;Strip<2;++Strip)
    {
        TArray<FVector> Vertices,Normals;TArray<int32> Indices;TArray<FVector2D> UV;TArray<FLinearColor> Colors;TArray<FProcMeshTangent> Tangents;
        for(int I=0;I<Samples;++I)
        {
            double Phi=2*PI*I/Samples;
            if(Strip==0)
            {
                const double U=Phi;Phi=U+ThetaF;
                for(int Iteration=0;Iteration<12;++Iteration)Phi-=(Phi-ThetaF+(Nc-Nf)/(2*Nf)*FMath::Sin(2*(Phi-ThetaW))-U)/(1+(Nc-Nf)/Nf*FMath::Cos(2*(Phi-ThetaW)));
            }
            else Phi+=ThetaC;
            const double Edge=Strip==0?Flex(Phi):Ring(Phi),Width=FMath::Max(.0004,H*3),Inner=Strip==0?Edge-Width:Edge,Outer=Strip==0?Edge:Edge+Width;
            for(int Corner=0;Corner<4;++Corner){const double Radius=(Corner==0||Corner==3)?Inner:Outer,Z=Corner<2?-.0006:.0006;Vertices.Add(VW::Position(FVector(Radius*FMath::Cos(Phi),Radius*FMath::Sin(Phi),Z)));UV.Add(FVector2D(double(I)/Samples,double(Corner)/3));}
        }
        // Four walls, closed at the periodic seam; no holes, no collision on explanatory geometry.
        for(int I=0;I<Samples;++I)for(int Edge=0;Edge<4;++Edge)
        {const int Next=(I+1)%Samples,Ai=4*I+Edge,Bi=4*Next+Edge,Ci=4*Next+(Edge+1)%4,Di=4*I+(Edge+1)%4;Indices.Append({Ai,Bi,Ci,Ai,Ci,Di});}
        if(VW::LoaderConfig().GetMatrix().Determinant()<0)for(int32 I=0;I<Indices.Num();I+=3)Swap(Indices[I+1],Indices[I+2]);
        UKismetProceduralMeshLibrary::CalculateTangentsForMesh(Vertices,Indices,UV,Normals,Tangents);
        PrincipleMesh->CreateMeshSection_LinearColor(Strip,Vertices,Indices,Normals,UV,Colors,Tangents,false);
    }
    if(PrincipleArmature)PrincipleArmature->SetRelativeLocation(VW::Position(FVector(0,-R*1.7,JointDynamics->snapshot().closure*JointDynamics->config.armatureTravel)));
}


void AVirtualWorldRuntime::FrameCadInspection(bool bPrincipleOnly)
{
    if(!Camera||!JointDynamics)return;
    FBox Bounds(ForceInit);
    if(!bPrincipleOnly)for(const auto& Entry:CadBindings)Bounds+=Entry.Component->Bounds.GetBox();
    if(bPrinciple&&PrincipleMesh)
    {
        Bounds+=PrincipleMesh->Bounds.GetBox();
        if(auto* Primitive=Cast<UPrimitiveComponent>(PrincipleArmature))Bounds+=Primitive->Bounds.GetBox();
        if(auto* Primitive=Cast<UPrimitiveComponent>(PrincipleBrakePole))Bounds+=Primitive->Bounds.GetBox();
    }
    if(!Bounds.IsValid)return;
    int32 Width=1280,Height=720;if(auto* PC=GetWorld()->GetFirstPlayerController()){int32 W=0,H=0;PC->GetViewportSize(W,H);if(W>0&&H>0){Width=W;Height=H;}}
    const double Panel=FMath::Min(450.,Width*.48),TanHorizontal=FMath::Tan(FMath::DegreesToRadians(Camera->GetCameraComponent()->FieldOfView*.5));
    const double AvailableTan=FMath::Min(TanHorizontal*(Width-Panel)/Width,TanHorizontal*Height/Width);
    const double Distance=Bounds.GetExtent().Size()/FMath::Sin(FMath::Atan(AvailableTan)) * 1.18;
    CameraTarget=Bounds.GetCenter();CameraOffset=CameraOffset.GetSafeNormal()*FMath::Max(.1,Distance);
    InspectionZoomMax=FMath::Max(InspectionZoomMax,static_cast<float>(Distance*50));UpdateCamera();
}


void AVirtualWorldRuntime::FrameCadBrakeInspection()
{
    if(!Camera||!PrincipleArmature||!PrincipleBrakePole)return;
    FBox Bounds(ForceInit);for(auto* Part:{PrincipleArmature,PrincipleBrakePole})if(auto* Primitive=Cast<UPrimitiveComponent>(Part))Bounds+=Primitive->Bounds.GetBox();
    int32 Width=1280,Height=720;if(auto* PC=GetWorld()->GetFirstPlayerController()){int32 W=0,H=0;PC->GetViewportSize(W,H);if(W>0&&H>0){Width=W;Height=H;}}
    const double TanHorizontal=FMath::Tan(FMath::DegreesToRadians(Camera->GetCameraComponent()->FieldOfView*.5)),Panel=FMath::Min(450.,Width*.48);
    const double Distance=Bounds.GetExtent().Size()/FMath::Sin(FMath::Atan(FMath::Min(TanHorizontal*(Width-Panel)/Width,TanHorizontal*Height/Width)))*1.18;
    CameraTarget=Bounds.GetCenter();CameraOffset=VW::Position(FVector(1,.3,.025)).GetSafeNormal()*Distance;CameraUp=VW::Position(FVector(0,0,1)).GetSafeNormal();UpdateCamera();
}

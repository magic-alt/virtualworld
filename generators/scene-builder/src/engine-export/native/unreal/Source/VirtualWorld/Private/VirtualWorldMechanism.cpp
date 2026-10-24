#include "VirtualWorldRuntime.h"
#include "VirtualWorldModel.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/ShapeComponent.h"
#include "Engine/SkeletalMesh.h"
#include "ProceduralMeshComponent.h"

bool AVirtualWorldRuntime::IsDescendant(const FString& Id,const FString& Ancestor) const
{
    FString Current=Id;
    while(const FVirtualWorldNode* Node=Nodes.Find(Current))
    {
        if(Current==Ancestor) return true;
        Current=Node->Parent;
    }
    return false;
}

bool AVirtualWorldRuntime::BindMechanism()
{
    if(VW::String(Mechanism,TEXT("kind"))==TEXT("cad-joint")) return BindCadJoint();
    if(VW::String(Mechanism,TEXT("kind"))!=TEXT("harmonic")) return Fail(TEXT("Unsupported mechanism kind."));
    for(const TCHAR* Key:{TEXT("waveNodeId"),TEXT("flexNodeId"),TEXT("outputNodeId")})
        if(!Nodes.Contains(VW::String(Mechanism,Key))) return Fail(TEXT("Missing harmonic node binding: ")+VW::String(Mechanism,Key));
    for(const TCHAR* Key:{TEXT("fixedNodeIds"),TEXT("fullHousingIds"),TEXT("sectionHousingIds")})
        for(const auto& Id:VW::Array(Mechanism,Key)) if(!Nodes.Contains(Id->AsString())) return Fail(TEXT("Missing harmonic node: ")+Id->AsString());
    if(VW::Number(Mechanism,TEXT("flexTeeth"))<=0 || VW::Number(Mechanism,TEXT("ringTeeth"))<=VW::Number(Mechanism,TEXT("flexTeeth"))) return Fail(TEXT("Invalid harmonic tooth counts."));
    const FName Cos(*VW::String(Mechanism,TEXT("cosMorph"))),Sin(*VW::String(Mechanism,TEXT("sinMorph")));
    for(const auto& Pair:Nodes)
    {
        if(!Pair.Value.Model || !IsDescendant(Pair.Key,VW::String(Mechanism,TEXT("flexNodeId")))) continue;
        TArray<USkeletalMeshComponent*> Components;Pair.Value.Model->GetComponents<USkeletalMeshComponent>(Components);
        for(USkeletalMeshComponent* Skin:Components)
        {
            USkeletalMesh* Mesh=Skin->GetSkeletalMeshAsset();
            const bool bCos=Mesh&&Mesh->FindMorphTarget(Cos),bSin=Mesh&&Mesh->FindMorphTarget(Sin);
            if(bCos!=bSin) return Fail(TEXT("Incomplete signed harmonic morph pair in ")+Pair.Key);
            if(bCos&&bSin) MorphComponents.Add(Skin);
        }
    }
    if(MorphComponents.IsEmpty()) return Fail(TEXT("No native skeletal mesh exposes both ")+Cos.ToString()+TEXT(" and ")+Sin.ToString());
    bHasBrake=false;
    for(const auto& Value:VW::Array(Mechanism,TEXT("subsystems")))
    {
        const VW::Json System=Value->AsObject();
        if(VW::String(System,TEXT("optional"))==TEXT("brake")) bHasBrake=true;
        for(const auto& Id:VW::Array(System,TEXT("nodeIds"))) if(!Nodes.Contains(Id->AsString())) return Fail(TEXT("Missing subsystem node: ")+Id->AsString());
    }
    bBrakeInstalled=bHasBrake;bBrakePowered=true;
    return true;
}

void AVirtualWorldRuntime::ApplyMechanism()
{
    if(!Mechanism) return;
    if(JointDynamics) {ApplyCadJoint();return;}
    const VW::Harmonic State=VW::Transmission(InputAngle,VW::Number(Mechanism,TEXT("flexTeeth")),VW::Number(Mechanism,TEXT("ringTeeth")));
    for(auto& Pair:Nodes)
    {
        FVirtualWorldNode& Node=Pair.Value;
        FQuat Rotation=VW::Quaternion(Node.Native,TEXT("rotation"));
        const bool bWave=Node.Id==VW::String(Mechanism,TEXT("waveNodeId"));
        const bool bOutput=Node.Id==VW::String(Mechanism,TEXT("flexNodeId"))||Node.Id==VW::String(Mechanism,TEXT("outputNodeId"));
        if(bWave||bOutput)
        {
            FVector Euler=VW::Vector(Node.Metadata,TEXT("rotation"));
            Euler.Y+=bWave?InputAngle:State.Output;
            Rotation=VW::EulerXYZ(Euler);
        }
        const FVector Translation=VW::Vector(Node.Native,TEXT("translation"))+VW::Vector(Node.Metadata,TEXT("explode"))*Explosion;
        Node.Wrapper->SetRelativeTransform(VW::Transform(Translation,Rotation,VW::Vector(Node.Native,TEXT("scale"),FVector::OneVector)));
    }
    for(USkeletalMeshComponent* Skin:MorphComponents)
    {
        // UE weights use unit amplitude. Preserve [-1,1], including negative phases.
        Skin->SetMorphTarget(FName(*VW::String(Mechanism,TEXT("cosMorph"))),State.Cos,false);
        Skin->SetMorphTarget(FName(*VW::String(Mechanism,TEXT("sinMorph"))),State.Sin,false);
    }
}

void AVirtualWorldRuntime::StepMechanism(float DeltaSeconds)
{
    if(!Mechanism||bPaused) return;
    if(JointDynamics) {JointDynamics->tick(DeltaSeconds,false,JointTimeScale);bRunning=JointDynamics->snapshot().running;InputAngle=JointDynamics->snapshot().angle+KinematicOffset;ApplyMechanism();return;}
    if(bRunning&&!(bBrakeInstalled&&!bBrakePowered)) InputAngle+=Rpm*2.*PI/60.*DeltaSeconds;
    ApplyMechanism();
}

void AVirtualWorldRuntime::ApplyVisibility()
{
    UpdateCadSections();UpdateCadTransparency();
    if(bPrinciple)UpdateCadPrinciple();
    if(PrincipleMesh) PrincipleMesh->SetVisibility(bPrinciple,true);
    TMap<FString,bool> Local;
    for(const auto& Pair:Nodes)
    {
        const FVirtualWorldNode& Node=Pair.Value;
        bool bVisible=VW::Bool(Node.Native,TEXT("visible"),true);
        if(Mechanism)
        {
            if(!JointDynamics&&VW::Contains(Mechanism,TEXT("fullHousingIds"),Node.Id)) bVisible=bVisible&&!bSection;
            if(!JointDynamics&&VW::Contains(Mechanism,TEXT("sectionHousingIds"),Node.Id)) bVisible=bSection;
            if(!IsolatedSubsystem.IsEmpty())
            {
                bool bIncluded=IsolatedNodes.Contains(Node.Id);
                for(const FString& Id:IsolatedNodes) if(IsDescendant(Id,Node.Id)) { bIncluded=true;break; }
                bVisible&=bIncluded;
            }
            for(const auto& Value:VW::Array(Mechanism,TEXT("subsystems")))
            {
                const VW::Json System=Value->AsObject();
                if(VW::Contains(System,TEXT("nodeIds"),Node.Id) && (HiddenSubsystems.Contains(VW::String(System,TEXT("id"))) || (VW::String(System,TEXT("optional"))==TEXT("brake")&&!bBrakeInstalled))) bVisible=false;
            }
        }
        Local.Add(Node.Id,bVisible);
    }
    for(auto& Pair:Nodes)
    {
        FVirtualWorldNode& Node=Pair.Value;Node.bVisible=Local[Node.Id];FString Parent=Node.Parent;
        while(!Parent.IsEmpty()) { Node.bVisible&=Local[Parent];Parent=Nodes[Parent].Parent; }
        if(Node.Model) Node.Model->SetActorHiddenInGame(!Node.bVisible);
        for(USceneComponent* Child:Node.Wrapper->GetAttachChildren())
            if(UShapeComponent* Shape=Cast<UShapeComponent>(Child)) Shape->SetCollisionEnabled(Node.bVisible?ECollisionEnabled::QueryOnly:ECollisionEnabled::NoCollision);
    }
    const auto* CadNode=Nodes.Find(VW::String(Mechanism,TEXT("modelNodeId")));
    const bool CadVisible=!CadNode||CadNode->bVisible;
    for(auto& Binding:CadBindings)
    {
        const bool Visible=CadVisible&&Binding.bOriginalVisible&&!VW::Bool(Binding.Data,TEXT("displayHidden"))&&!(bSection&&VW::Bool(Binding.Data,TEXT("inspectionHidden")));
        Binding.Component->SetVisibility(Visible&&!(bSection&&Binding.bInspectionBuilt),false);
        if(Binding.InspectionMesh)Binding.InspectionMesh->SetVisibility(Visible&&bSection,false);
        if(Binding.Marker) Binding.Marker->SetVisibility(Visible&&bRollingMarkers,false);
    }

}

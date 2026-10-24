#include "VirtualWorldRuntime.h"
#include "Components/StaticMeshComponent.h"
#include "ProceduralMeshComponent.h"
#include "KismetProceduralMeshLibrary.h"
#include "Engine/StaticMesh.h"
#include "StaticMeshResources.h"

#include "VirtualWorldCadWindow.h"

bool VWPartitionCadWindow(UProceduralMeshComponent* Inside,const FTransform& Model,const FVector& Axis,const FVector& Pivot,double Radius,TArray<FProcMeshSection>& Outside)
{
    const int Slots=Inside->GetNumSections();Outside.SetNum(Slots);FVector U,V;Axis.FindBestAxisVectors(U,V);
    TArray<UMaterialInterface*> OriginalMaterials;for(int S=0;S<Slots;++S)OriginalMaterials.Add(Inside->GetMaterial(S));
    // Disjoint partitions of the original surfaces, not a hole or a physical CAD cut.
    // Aggregate fragments by source slot so64 planes do not create64 draw calls.
    for(int Plane=0;Plane<64;++Plane)
    {
        const double Angle=2*PI*Plane/64;const FVector Radial=U*FMath::Cos(Angle)+V*FMath::Sin(Angle);
        const FVector Position=Model.TransformPosition(VW::Position(Pivot+Radial*Radius));
        const FVector Normal=Model.GetRotation().RotateVector(VW::Position(-Radial).GetSafeNormal()/Model.GetScale3D()).GetSafeNormal();
        UProceduralMeshComponent* Other=nullptr;
        UKismetProceduralMeshLibrary::SliceProceduralMesh(Inside,Position,Normal,true,Other,EProcMeshSliceCapOption::NoCap,nullptr);
        if(Other)
        {
            for(int S=0;S<Other->GetNumSections();++S)if(const auto* Part=Other->GetProcMeshSection(S))
            {
                // UE compacts Other sections; their index is not the source slot.
                // Equal material pointers may safely share one aggregate: all vertex UVs survive.
                const int MaterialSlot=OriginalMaterials.IndexOfByKey(Other->GetMaterial(S));
                if(MaterialSlot==INDEX_NONE){Other->DestroyComponent();return false;}
                auto& Aggregate=Outside[MaterialSlot];const uint32 Offset=Aggregate.ProcVertexBuffer.Num();Aggregate.ProcVertexBuffer.Append(Part->ProcVertexBuffer);
                for(uint32 Index:Part->ProcIndexBuffer)Aggregate.ProcIndexBuffer.Add(Offset+Index);
                Aggregate.SectionLocalBox+=Part->SectionLocalBox;Aggregate.bSectionVisible=true;Aggregate.bEnableCollision=false;
            }
            Other->DestroyComponent();
        }
    }
    return true;
}

bool AVirtualWorldRuntime::BuildCadTransparencyWindow(FVirtualWorldCadBinding& Entry,double Radius)
{
    if(Entry.bInspectionBuilt)return true;
    auto* Source=Cast<UStaticMeshComponent>(Entry.Component);
    const auto* Data=Source&&Source->GetStaticMesh()?Source->GetStaticMesh()->GetRenderData():nullptr;
    if(!CadModelRoot||!Data||Data->LODResources.IsEmpty()||Data->LODResources[0].VertexBuffers.PositionVertexBuffer.GetNumVertices()==0)
    {Notice=TEXT("Central inspection has no CPU surface geometry; original opaque part retained.");return false;}
    auto* Inside=NewObject<UProceduralMeshComponent>(this);AddInstanceComponent(Inside);Inside->SetupAttachment(Source);Inside->RegisterComponent();Inside->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    UKismetProceduralMeshLibrary::CopyProceduralMeshFromStaticMeshComponent(Source,0,Inside,false);
    const int32 Slots=Inside->GetNumSections();TArray<FProcMeshSection> Outside;Outside.SetNum(Slots);
    TArray<UMaterialInterface*> Materials;for(int S=0;S<Slots;++S)Materials.Add(Inside->GetMaterial(S));
    const FVector Axis=VW::Vector(Entry.Data,TEXT("axis")),Pivot=VW::Vector(Entry.Data,TEXT("pivot"));
    const auto Model=CadModelRoot->GetComponentTransform();
    if(!VWPartitionCadWindow(Inside,Model,Axis,Pivot,Radius,Outside)||Entry.TransparentInspectionMaterials.IsEmpty())
    {Inside->DestroyComponent();Notice=TEXT("Central inspection material mapping failed; original opaque part retained.");return false;}
    auto* Window=NewObject<UProceduralMeshComponent>(this);AddInstanceComponent(Window);Window->SetupAttachment(Source);Window->RegisterComponent();Window->SetCollisionEnabled(ECollisionEnabled::NoCollision);SceneComponents.Add(Window);
    for(int S=0;S<Slots;++S)
    {
        Window->SetProcMeshSection(S,Outside[S]);Window->SetMaterial(S,Materials[S]);
        if(const auto* Center=Inside->GetProcMeshSection(S))
        {
            int MaterialIndex=0;for(int M=0;M<Entry.OriginalInspectionMaterials.Num();++M)if(Entry.OriginalInspectionMaterials[M].Get()==Materials[S]){MaterialIndex=M;break;}
            Window->SetProcMeshSection(Slots+S,*Center);Window->SetMaterial(Slots+S,Entry.TransparentInspectionMaterials[MaterialIndex].Get());
        }
    }
    Inside->DestroyComponent();Window->SetCastShadow(Entry.bOriginalCastShadow);
    Entry.InspectionMesh=Window;Entry.bInspectionBuilt=true;++Entry.InspectionRevision;return true;
}

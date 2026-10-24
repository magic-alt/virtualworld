#pragma once
#include "CoreMinimal.h"
#include "ProceduralMeshComponent.h"

// Internal display partition; callers retain source geometry and material slots.
bool VWPartitionCadWindow(UProceduralMeshComponent* Inside,const FTransform& Model,const FVector& Axis,const FVector& Pivot,double Radius,TArray<FProcMeshSection>& Outside);

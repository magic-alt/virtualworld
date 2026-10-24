#pragma once
#include "CoreMinimal.h"

namespace VW
{
/** Cancellation and scene identity are checked before any candidate is committed. */
struct FImportGeneration
{
    uint64 Generation=0;
    uint64 Active=0;
    FString Scene;
    bool bBusy=false;
    uint64 Begin(const FString& Identity) {Active=++Generation;Scene=Identity;bBusy=true;return Active;}
    void Cancel() {++Generation;bBusy=false;Scene.Empty();}
    bool CanCommit(uint64 Ticket,const FString& Identity) const {return bBusy&&Active==Ticket&&Generation==Ticket&&Scene==Identity;}
};
}

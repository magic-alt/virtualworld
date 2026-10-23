#include "VirtualWorldRuntime.h"
#include "VirtualWorldModel.h"
#include "glTFRuntimeAsset.h"
#include "Camera/CameraActor.h"
#include "Components/SceneComponent.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformProcess.h"
#include "HAL/PlatformTime.h"
#include "Misc/FileHelper.h"
#include "Misc/Guid.h"
#include "Misc/Paths.h"
#include "UObject/StrongObjectPtr.h"
#if PLATFORM_WINDOWS
#include "Framework/Application/SlateApplication.h"
#include "Windows/AllowWindowsPlatformTypes.h"
#include "Windows/WindowsHWrapper.h"
#include <commdlg.h>
#include "Windows/HideWindowsPlatformTypes.h"
#endif

namespace
{
bool ReadImportJson(const FString& Path,VW::Json& Result)
{
    const int64 Size=IFileManager::Get().FileSize(*Path);
    FString Text;
    return Size>0&&Size<4*1024*1024&&FFileHelper::LoadFileToString(Text,*Path)&&VW::Parse(Text,Result);
}
bool ArgumentSafe(const FString& Value)
{
    return !Value.IsEmpty()&&!Value.Contains(TEXT("\""))&&!Value.Contains(TEXT("\r"))&&!Value.Contains(TEXT("\n"));
}
}

void AVirtualWorldRuntime::EndPlay(const EEndPlayReason::Type Reason)
{
    ClearScene();
    Super::EndPlay(Reason);
}

void AVirtualWorldRuntime::CancelStepImport()
{
    ImportGeneration.Cancel();
    if(ImportProcess.IsValid())
    {
        if(FPlatformProcess::IsProcRunning(ImportProcess)) FPlatformProcess::TerminateProc(ImportProcess,true);
        FPlatformProcess::CloseProc(ImportProcess);
        ImportProcess.Reset();
    }
}

void AVirtualWorldRuntime::BeginStepImport()
{
    if(!IsModuleViewer()||ImportGeneration.bBusy) return;
#if PLATFORM_WINDOWS
    // A single file, no editor-only DesktopPlatform dependency: also works in desktop builds.
    WCHAR Filename[32768]={0};
    OPENFILENAMEW Dialog={};Dialog.lStructSize=sizeof(Dialog);
    Dialog.hwndOwner=static_cast<HWND>(const_cast<void*>(FSlateApplication::Get().FindBestParentWindowHandleForDialogs(nullptr)));
    Dialog.lpstrFilter=L"STEP model (*.stp;*.step)\0*.stp;*.step\0\0";
    Dialog.lpstrFile=Filename;Dialog.nMaxFile=UE_ARRAY_COUNT(Filename);
    Dialog.Flags=OFN_FILEMUSTEXIST|OFN_PATHMUSTEXIST|OFN_NOCHANGEDIR|OFN_EXPLORER;
    PointerDrag.Reset();
    if(!GetOpenFileNameW(&Dialog)) {Notice=CommDlgExtendedError()?TEXT("Cannot open STEP file chooser."):TEXT("Import cancelled; current module retained.");return;}
    StartStepImport(Filename);
#else
    Notice=TEXT("Local STEP file selection is currently supported on Windows desktop.");
#endif
}

void AVirtualWorldRuntime::StartStepImport(const FString& Source)
{
    if(!IsModuleViewer()||ImportGeneration.bBusy) return;
    const FString Extension=FPaths::GetExtension(Source).ToLower();
    const int64 Size=IFileManager::Get().FileSize(*Source);
    if((Extension!=TEXT("stp")&&Extension!=TEXT("step"))||Size<=0||Size>100LL*1024*1024)
    {Notice=TEXT("Choose a nonempty STEP/STP file up to 100 MiB. Current module retained.");return;}
    const FString Tool=FPaths::ConvertRelativePathToFull(FPaths::ProjectContentDir()/TEXT("VirtualWorldTools/step-import.cjs"));
    ImportDirectory=FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir()/TEXT("VirtualWorld/Imports")/FGuid::NewGuid().ToString(EGuidFormats::Digits));
    if(!ArgumentSafe(Source)||!ArgumentSafe(Tool)||!ArgumentSafe(ImportDirectory)||!FPaths::FileExists(Tool))
    {Notice=TEXT("STEP converter unavailable. Re-export this project with its VirtualWorldTools directory.");return;}
    IFileManager::Get().MakeDirectory(*FPaths::GetPath(ImportDirectory),true);
    const FString Args=FString::Printf(TEXT("\"%s\" \"%s\" \"%s\""),*Tool,*Source,*ImportDirectory);
    ImportProcess=FPlatformProcess::CreateProc(TEXT("node.exe"),*Args,false,true,true,nullptr,0,nullptr,nullptr);
    if(!ImportProcess.IsValid()) {Notice=TEXT("Cannot start STEP converter. Install Node.js 24+ on PATH, then restart UE. Current module retained.");return;}
    ImportGeneration.Begin(SceneOrder[SceneIndex]);ImportStart=FPlatformTime::Seconds();
    Notice=TEXT("Converting STEP locally... Current module remains visible. Cancel to stop.");
}

void AVirtualWorldRuntime::PollStepImport()
{
    if(!ImportGeneration.bBusy) return;
    if(!SceneOrder.IsValidIndex(SceneIndex)||!ImportGeneration.CanCommit(ImportGeneration.Active,SceneOrder[SceneIndex])) {CancelStepImport();return;}
    if(FPlatformProcess::IsProcRunning(ImportProcess))
    {
        if(FPlatformTime::Seconds()-ImportStart>90.) {CancelStepImport();Notice=TEXT("STEP conversion exceeded 90 seconds. Simplify the file and retry; current module retained.");}
        return;
    }
    int32 ExitCode=-1;
    FPlatformProcess::GetProcReturnCode(ImportProcess,&ExitCode);
    FPlatformProcess::CloseProc(ImportProcess);ImportProcess.Reset();
    const FString CompletedDirectory=ImportDirectory;
    if(ExitCode!=0) {CancelStepImport();Notice=TEXT("STEP conversion failed. Check Node.js 24+, file validity and model complexity. Current module retained.");return;}
    if(!CommitStepImport(CompletedDirectory))
    {CancelStepImport();Notice=TEXT("STEP load failed: ")+ImportFailure+TEXT(" Current module retained.");}
}

bool AVirtualWorldRuntime::CommitStepImport(const FString& Directory)
{
    ImportFailure=TEXT("invalid or incomplete conversion output.");
    VW::Json Imported,Validation,SourceSpec;
    if(!ReadImportJson(Directory/TEXT("engine-manifest.json"),Imported)||!ReadImportJson(Directory/TEXT("validation.json"),Validation)||!ReadImportJson(Directory/TEXT("scene.json"),SourceSpec)) return false;
    const auto Assets=VW::Array(Imported,TEXT("assets")),ScenesIn=VW::Array(Imported,TEXT("scenes"));
    const VW::Json Coordinates=VW::Object(Imported,TEXT("coordinates"));
    if(VW::Number(Imported,TEXT("version"))!=1||VW::String(Imported,TEXT("target"))!=TEXT("unreal")||Assets.Num()!=1||ScenesIn.Num()!=1||VW::Number(Validation,TEXT("errors"),-1)!=0||
        VW::String(Coordinates,TEXT("handedness"))!=TEXT("right")||VW::String(Coordinates,TEXT("up"))!=TEXT("Y")||VW::String(Coordinates,TEXT("units"))!=TEXT("metres")||VW::String(Coordinates,TEXT("quaternion"))!=TEXT("xyzw")) return false;
    const VW::Json Record=Assets[0]->AsObject(),NewScene=ScenesIn[0]->AsObject();
    const FString Id=VW::String(Record,TEXT("id"));
    bool bHex=Id.Len()==64;for(TCHAR C:Id) bHex&=(C>='0'&&C<='9')||(C>='a'&&C<='f');
    if(!bHex||VW::String(Record,TEXT("sha256"))!=Id||VW::String(Record,TEXT("path"))!=TEXT("models/")+Id+TEXT(".glb")||VW::String(Validation,TEXT("glbSha256"))!=Id) return false;
    const auto NewNodes=VW::Array(NewScene,TEXT("nodes"));
    VW::Json NewMetadata,NodeMetadata;
    if(NewNodes.Num()!=1||!VW::Parse(VW::String(NewScene,TEXT("metadataJson")),NewMetadata)||VW::Serialize(NewMetadata)!=VW::Serialize(SourceSpec)||VW::Object(NewMetadata,TEXT("mechanism"))||VW::Object(NewMetadata,TEXT("actor"))) return false;
    const VW::Json Native=NewNodes[0]->AsObject();
    if(VW::String(Native,TEXT("id"))!=TEXT("module")||!VW::String(Native,TEXT("parentId")).IsEmpty()||VW::String(Native,TEXT("model"))!=Id||!VW::Parse(VW::String(Native,TEXT("metadataJson")),NodeMetadata)) return false;
    const double Size=VW::Number(Record,TEXT("bytes"));
    if(Size<20||Size>256.*1024*1024||Size!=FMath::FloorToDouble(Size)) return false;
    const FString Path=Directory/VW::String(Record,TEXT("path"));TArray<uint8> Bytes;
    if(IFileManager::Get().FileSize(*Path)!=static_cast<int64>(Size)||!FFileHelper::LoadFileToArray(Bytes,*Path)||VW::Digest(Bytes)!=Id) return false;

    // Stage through the same importer with a hidden actor; the live module is untouched on error.
    const FString PreviousData=DataDirectory,PreviousError=FatalError;
    const VW::Json PreviousRecord=ModelRecords.FindRef(Id);
    const bool bHadCache=AssetCache.Contains(Id);
    const int32 StagedStart=SpawnedActors.Num();
    ModelRecords.Add(Id,Record);DataDirectory=Directory;bStagingModel=true;
    USceneComponent* Wrapper=NewObject<USceneComponent>(this);
    AddInstanceComponent(Wrapper);Wrapper->SetupAttachment(RootComponent);Wrapper->RegisterComponent();
    AVirtualWorldModel* Model=SpawnModel(Id,Wrapper,false,false,true);
    bStagingModel=false;DataDirectory=PreviousData;
    if(PreviousRecord) ModelRecords.Add(Id,PreviousRecord);else ModelRecords.Remove(Id);
    const FBox Bounds=Model?Model->GetComponentsBoundingBox(true):FBox(ForceInit);
    const bool bValid=Model&&FatalError.IsEmpty()&&Bounds.IsValid&&!Bounds.GetSize().ContainsNaN()&&Bounds.GetSize().GetMax()>SMALL_NUMBER;
    if(!bValid)
    {
        ImportFailure=TEXT("converted model has no usable geometry.");FatalError=PreviousError;
        // SpawnModel may have failed after allocating its actor.
        for(int32 I=SpawnedActors.Num()-1;I>=StagedStart;--I)
        {if(IsValid(SpawnedActors[I])) SpawnedActors[I]->Destroy();SpawnedActors.RemoveAt(I);}
        if(!bHadCache) AssetCache.Remove(Id);
        Wrapper->DestroyComponent();return false;
    }
    TStrongObjectPtr<UglTFRuntimeAsset> Asset(Model->Asset);
    SpawnedActors.Remove(Model);
    ClearScene(); // Commit: old actors and cache are released before the candidate becomes visible.
    bImportedModule=true;Mechanism.Reset();Scene=NewScene;Metadata=NewMetadata;
    SceneComponents.Add(Wrapper);SpawnedActors.Add(Model);AssetCache.Add(Id,Asset.Get());
    FVirtualWorldNode Node;Node.Id=TEXT("module");Node.Native=Native;Node.Metadata=NodeMetadata;Node.Wrapper=Wrapper;Node.Model=Model;Nodes.Add(Node.Id,Node);
    Model->SetActorHiddenInGame(false);
    BuildCameraAndLight();FitImportedCamera();
    Notice=TEXT("Imported ")+VW::String(NewMetadata,TEXT("name"))+TEXT(" | Static STEP assembly; no motion parameters inferred.");
    if(VW::Number(Validation,TEXT("warnings"))>0) Notice+=TEXT(" Validator warnings retained in Saved/VirtualWorld/Imports.");
    return true;
}

void AVirtualWorldRuntime::FitImportedCamera()
{
    FBox Bounds(ForceInit);for(const auto& Pair:Nodes) if(Pair.Value.Model) Bounds+=Pair.Value.Model->GetComponentsBoundingBox(true);
    if(!Bounds.IsValid) return;
    const double Radius=FMath::Max(.001,Bounds.GetExtent().Size());
    int32 Width=1280,Height=720;if(APlayerController* PC=GetWorld()->GetFirstPlayerController()) PC->GetViewportSize(Width,Height);
    const double Aspect=FMath::Max(.2,static_cast<double>(Width)/FMath::Max(1,Height));
    const double Panel=FMath::Min(.8,static_cast<double>(VW::ControlPanelWidth(Width))/FMath::Max(1,Width));
    const double Distance=Radius*1.2/FMath::Sin(FMath::Atan(FMath::Tan(FMath::DegreesToRadians(25.))*FMath::Min(1.-Panel,1./Aspect)));
    CameraOffset=FVector(1,1,.7).GetSafeNormal()*Distance;CameraUp=FVector::UpVector;
    const FVector Right=FVector::CrossProduct(CameraUp,-CameraOffset.GetSafeNormal()).GetSafeNormal();
    CameraTarget=Bounds.GetCenter()-Right*(Distance*FMath::Tan(FMath::DegreesToRadians(25.))*Panel);
    PointerDrag.Reset();UpdateCamera();
}

#include "VirtualWorldRuntime.h"
#include "VirtualWorldModel.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformTime.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Framework/Application/SlateApplication.h"
#include "Widgets/SWindow.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/SBoxPanel.h"
#if WITH_EDITOR
#include "DesktopPlatformModule.h"
#include "IDesktopPlatform.h"
#endif

void AVirtualWorldRuntime::ChooseCadFile()
{
    if(CadProcess.IsValid()) return;
#if WITH_EDITOR
    if(IDesktopPlatform* Desktop=FDesktopPlatformModule::Get())
    {
        TArray<FString> Files;
        if(Desktop->OpenFileDialog(FSlateApplication::Get().FindBestParentWindowHandleForDialogs(nullptr),TEXT("Import STEP / STP"),FPaths::ProjectDir(),TEXT(""),TEXT("STEP / STP|*.step;*.stp;*.STEP;*.STP"),0,Files)&&Files.Num()==1)
            BeginCadImport(Files[0]);
        return;
    }
#endif
    // Packaged games cannot depend on the editor's DesktopPlatform module.
    TSharedRef<SWindow> Window=SNew(SWindow).Title(FText::FromString(TEXT("Import local STEP / STP"))).ClientSize(FVector2D(640,120)).SupportsMaximize(false).SupportsMinimize(false);
    TSharedPtr<SEditableTextBox> Path;
    TWeakObjectPtr<AVirtualWorldRuntime> WeakThis(this);
    Window->SetContent(SNew(SVerticalBox)
        +SVerticalBox::Slot().Padding(12).AutoHeight()[SAssignNew(Path,SEditableTextBox).HintText(FText::FromString(TEXT("Absolute path to a .step or .stp file")))]
        +SVerticalBox::Slot().Padding(12).AutoHeight()[SNew(SButton).Text(FText::FromString(TEXT("Import"))).OnClicked_Lambda([WeakThis,Path,Window]()
        { if(WeakThis.IsValid()) WeakThis->BeginCadImport(Path->GetText().ToString()); Window->RequestDestroyWindow();return FReply::Handled(); })]);
    FSlateApplication::Get().AddWindow(Window);
}

void AVirtualWorldRuntime::BeginCadImport(const FString& Path)
{
    if(CadProcess.IsValid()) return;
    const FString Extension=FPaths::GetExtension(Path).ToLower();
    const int64 Size=IFileManager::Get().FileSize(*Path);
    if((Extension!=TEXT("step")&&Extension!=TEXT("stp"))||Size<=0||Size>100LL*1024*1024)
    { Notice=TEXT("Choose a nonempty STEP / STP file, at most 100 MiB.");WriteCadReport(false,Notice);return; }
    FString Node=FPlatformMisc::GetEnvironmentVariable(TEXT("VW_NODE_EXECUTABLE"));
    const FString Helper=FPaths::ConvertRelativePathToFull(FPaths::ProjectContentDir()/TEXT("VirtualWorldTools/Cad/import-cad.mjs"));
    if(Node.IsEmpty()||!FPaths::FileExists(Node)||!FPaths::FileExists(Helper))
    { Notice=TEXT("CAD helper unavailable. Launch with Scripts/native.mjs using Node.js 24; prepare this project with npm run native:export.");WriteCadReport(false,Notice);return; }
    CadRequestId=FGuid::NewGuid().ToString(EGuidFormats::Digits);
    CadDirectory=FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir()/TEXT("VirtualWorld/Imports")/CadRequestId);
    if(!IFileManager::Get().MakeDirectory(*CadDirectory,true)) {Notice=TEXT("Cannot create the local import directory.");return;}
    const VW::Json Request=MakeShared<FJsonObject>();
    Request->SetStringField(TEXT("requestId"),CadRequestId);
    Request->SetStringField(TEXT("input"),FPaths::ConvertRelativePathToFull(Path));
    Request->SetStringField(TEXT("output"),CadDirectory/TEXT("converted"));
    Request->SetStringField(TEXT("catalog"),DataDirectory);
    Request->SetStringField(TEXT("result"),CadDirectory/TEXT("result.json"));
    const FString RequestPath=CadDirectory/TEXT("request.json");
    // User-selected paths are JSON data; only generated/trusted paths appear in process arguments. No shell.
    if(!FFileHelper::SaveStringToFile(VW::Serialize(Request),*RequestPath,FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM))
    { Notice=TEXT("Cannot save the import request.");return; }
    if(Helper.Contains(TEXT("\""))||RequestPath.Contains(TEXT("\"")))
    {Notice=TEXT("Move the project to a directory without double quotes.");return;}
    FPlatformProcess::CreatePipe(CadReadPipe,CadWritePipe);
    const FString Arguments=FString::Printf(TEXT("\"%s\" --request \"%s\""),*Helper,*RequestPath);
    CadProcess=FPlatformProcess::CreateProc(*Node,*Arguments,false,true,true,nullptr,0,nullptr,CadWritePipe,nullptr,CadWritePipe);
    FPlatformProcess::ClosePipe(nullptr,CadWritePipe);CadWritePipe=nullptr;
    if(!CadProcess.IsValid())
    { FPlatformProcess::ClosePipe(CadReadPipe,nullptr);CadReadPipe=nullptr;Notice=TEXT("Cannot start the local Node.js CAD converter.");WriteCadReport(false,Notice);return; }
    CadStartedAt=FPlatformTime::Seconds();CadGeneration=SceneGeneration;CadLog.Empty();
    Notice=TEXT("Converting STEP locally... Current scene remains available. Cancel import stops conversion.");
}

void AVirtualWorldRuntime::CancelCadImport(const FString& Message)
{
    if(!CadProcess.IsValid()) return;
    FPlatformProcess::TerminateProc(CadProcess,true);
    FPlatformProcess::WaitForProc(CadProcess);
    FPlatformProcess::CloseProc(CadProcess);CadProcess.Reset();
    FPlatformProcess::ClosePipe(CadReadPipe,CadWritePipe);CadReadPipe=nullptr;CadWritePipe=nullptr;
    Notice=Message;WriteCadReport(false,Message);
}

void AVirtualWorldRuntime::TickCadImport()
{
    if(!CadProcess.IsValid()) return;
    CadLog+=FPlatformProcess::ReadPipe(CadReadPipe);CadLog=CadLog.Right(8192);
    if(CadGeneration!=SceneGeneration) {CancelCadImport(TEXT("Import cancelled: scene changed."));return;}
    if(FPlatformTime::Seconds()-CadStartedAt>180.) {CancelCadImport(TEXT("STEP conversion exceeded 180 seconds. Simplify the assembly and retry."));return;}
    if(FPlatformProcess::IsProcRunning(CadProcess)) return;
    int32 ReturnCode=-1;FPlatformProcess::GetProcReturnCode(CadProcess,&ReturnCode);
    FPlatformProcess::CloseProc(CadProcess);CadProcess.Reset();
    FPlatformProcess::ClosePipe(CadReadPipe,CadWritePipe);CadReadPipe=nullptr;CadWritePipe=nullptr;
    FString Text;VW::Json Result;
    if(!FFileHelper::LoadFileToString(Text,*(CadDirectory/TEXT("result.json")))||!VW::Parse(Text,Result)||VW::String(Result,TEXT("requestId"))!=CadRequestId)
    { Notice=TEXT("Local converter failed without a valid result. ")+CadLog.Left(400);WriteCadReport(false,Notice);return; }
    if(ReturnCode!=0||!VW::Bool(Result,TEXT("success")))
    {Notice=TEXT("STEP import failed: ")+VW::String(Result,TEXT("error"));WriteCadReport(false,Notice);return;}
    const FString Expected=CadDirectory/TEXT("converted/Content/VirtualWorldData");
    FString Returned=FPaths::ConvertRelativePathToFull(VW::String(Result,TEXT("dataDirectory")));
    FPaths::NormalizeDirectoryName(Returned);
    FString NormalExpected=Expected;FPaths::NormalizeDirectoryName(NormalExpected);
    if(Returned!=NormalExpected) {Notice=TEXT("Converter returned an unexpected data directory.");WriteCadReport(false,Notice);return;}
    const bool bLoaded=InstallCadCatalog(Expected,VW::String(Result,TEXT("sceneId")));
    WriteCadReport(bLoaded,Notice);
}

bool AVirtualWorldRuntime::InstallCadCatalog(const FString& Directory,const FString& SceneId)
{
    const auto OldManifest=Manifest;const auto OldScenes=Scenes;const auto OldMetadata=Metadatas;
    const auto OldRecords=ModelRecords;const auto OldOrder=SceneOrder;const auto OldProgress=Progress;
    const FString OldDirectory=DataDirectory,OldLaunch=LaunchSceneId;const int32 OldIndex=SceneIndex;
    const FVector OldOffset=CameraOffset,OldTarget=CameraTarget,OldUp=CameraUp;
    DataDirectory=Directory;Scenes.Reset();Metadatas.Reset();ModelRecords.Reset();SceneOrder.Reset();Progress.Reset();
    bool bValid=ReadCatalog();const int32 Index=SceneOrder.IndexOfByKey(SceneId);
    if(bValid&&Index!=INDEX_NONE)
    {
        // Extend only: a converter cannot silently replace existing scene definitions.
        for(int32 I=0;I<OldScenes.Num();++I)
            if(!Scenes.IsValidIndex(I)||VW::Serialize(Scenes[I])!=VW::Serialize(OldScenes[I])) bValid=false;
    }
    else bValid=false;
    if(bValid)
    {
        LaunchSceneId=SceneId;
        for(const auto& Pair:OldProgress) Progress.Add(Pair.Key,Pair.Value);
        if(LoadScene(Index)) {Notice=TEXT("Imported ")+VW::String(Metadata,TEXT("name"))+TEXT(". Units: metres. Original file and validation receipt saved locally.");return true;}
    }
    const FString Error=FatalError.IsEmpty()?TEXT("Invalid converted catalog"):FatalError;
    Manifest=OldManifest;Scenes=OldScenes;Metadatas=OldMetadata;ModelRecords=OldRecords;SceneOrder=OldOrder;Progress=OldProgress;DataDirectory=OldDirectory;LaunchSceneId=OldLaunch;FatalError.Empty();
    if(SceneIndex!=OldIndex||!Camera) LoadScene(OldIndex);
    CameraOffset=OldOffset;CameraTarget=OldTarget;CameraUp=OldUp;UpdateCamera();
    Notice=TEXT("Import failed; previous scene restored: ")+Error;return false;
}

void AVirtualWorldRuntime::WriteCadReport(bool bSuccess,const FString& Message)
{
    const VW::Json Report=MakeShared<FJsonObject>();
    Report->SetBoolField(TEXT("success"),bSuccess);Report->SetStringField(TEXT("requestId"),CadRequestId);
    Report->SetStringField(TEXT("message"),Message);Report->SetStringField(TEXT("dataDirectory"),DataDirectory);
    if(SceneOrder.IsValidIndex(SceneIndex)) Report->SetStringField(TEXT("sceneId"),SceneOrder[SceneIndex]);
    FBox Bounds(ForceInit);int32 Meshes=0;
    for(const auto& Pair:Nodes) if(Pair.Value.Model)
    {
        Bounds+=Pair.Value.Model->GetComponentsBoundingBox(true);
        TArray<UStaticMeshComponent*> Parts;Pair.Value.Model->GetComponents<UStaticMeshComponent>(Parts);
        Meshes+=Parts.Num();
    }
    Report->SetNumberField(TEXT("staticMeshes"),Meshes);
    if(Bounds.IsValid)
    {
        const FVector Size=Bounds.GetSize();
        TArray<TSharedPtr<FJsonValue>> Values;
        for(double Value:{Size.X,Size.Y,Size.Z}) Values.Add(MakeShared<FJsonValueNumber>(Value));
        Report->SetArrayField(TEXT("boundsCentimetres"),Values);
    }
    const FString ReportPath=FPaths::ProjectSavedDir()/TEXT("VirtualWorld/import-report.json");
    IFileManager::Get().MakeDirectory(*FPaths::GetPath(ReportPath),true);
    FFileHelper::SaveStringToFile(VW::Serialize(Report),*ReportPath,FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
    UE_LOG(LogTemp,Display,TEXT("VirtualWorld CAD %s: %s"),bSuccess?TEXT("loaded"):TEXT("failed"),*Message);
}

void AVirtualWorldRuntime::EndPlay(const EEndPlayReason::Type Reason)
{
    CancelCadImport(TEXT("Import cancelled: player closed."));
    ClearScene();Super::EndPlay(Reason);
}

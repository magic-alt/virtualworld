#include "VirtualWorldRuntime.h"
#include "Components/SceneComponent.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"

TArray<FString> AVirtualWorldRuntime::StatusLines() const
{
    TArray<FString> Lines;
    if(!FatalError.IsEmpty()) {Lines.Add(TEXT("Cannot load this native scene"));Lines.Add(FatalError);Lines.Add(TEXT("See Saved/Logs/VirtualWorld.log and README-Unreal.md."));return Lines;}
    if(!Metadata) {Lines.Add(TEXT("Loading canonical scene assets..."));return Lines;}
    Lines.Add(VW::String(Metadata,TEXT("name")));
    Lines.Add(TEXT("Right drag / arrows: orbit. Wheel over scene: zoom."));
    if(Mechanism)
    {
        if(JointDynamics)
        {
            const auto State=JointDynamics->snapshot();
            const auto Factors=CadTransmission();const auto Gear=VW::Object(Mechanism,TEXT("gear"));
            Lines.Add(FString::Printf(TEXT("Input %.4f rpm | Output %+.6f rpm"),State.omega*30/PI,State.omega*30/PI*Factors.output));
            Lines.Add(FString::Printf(TEXT("Angle: input %.5f rad | output %+.5f rad"),InputAngle,InputAngle*Factors.output));
            if(Factors.resolved)
            {
                const bool Stated=VW::String(Gear,TEXT("status"))==TEXT("user-specified");
                const FString Fixed=Stated?VW::String(Gear,TEXT("fixedMember")):TEXT("circular-spline");
                Lines.Add(FString::Printf(TEXT("Reduction %.6g:1 | %s | fixed %s%s"),1/FMath::Abs(Factors.output),Stated?TEXT("user-provided"):TEXT("evidenced teeth"),*Fixed,Stated?TEXT(" (inferred)"):TEXT("")));
            }
            else Lines.Add(TEXT("Transmission unresolved: output remains static."));
            Lines.Add(FString::Printf(TEXT("Brake %s | Closure %.1f%% | t %.4f s"),UTF8_TO_TCHAR(State.brakePhase),State.closure*100,State.time));
            Lines.Add(FString::Printf(TEXT("Whole clock %.2fx [T] | Setpoint %.1f rpm | P pauses"),JointTimeScale,Rpm));
            Lines.Add(TEXT("M markers | C section | G principle | H assembly | T clock"));
            Lines.Add(TEXT("Orange input / blue output. Demonstration dynamics; actual teeth and brake performance unmeasured."));
            if(bPrinciple)
            {
                const auto P=VW::Object(Mechanism,TEXT("principle"));
                Lines.Add(FString::Printf(TEXT("PRINCIPLE: hypothetical %.0f / %.0f teeth; not measured CAD teeth"),VW::Number(P,TEXT("flexTeeth")),VW::Number(P,TEXT("ringTeeth"))));
                Lines.Add(FString::Printf(TEXT("Assumed brake gap %.4f mm | Profile minimum gap %.6f mm"),JointDynamics->config.armatureTravel*(1-State.closure)*1000,PrincipleMinGap*1000));
            }
        }
        else
        {
        const VW::Harmonic State=VW::Transmission(InputAngle,VW::Number(Mechanism,TEXT("flexTeeth")),VW::Number(Mechanism,TEXT("ringTeeth")));
        const double ActualRpm=bRunning&&!bPaused&&!(bBrakeInstalled&&!bBrakePowered)?Rpm:0.;
        const double OutputRpm=ActualRpm==0?0:ActualRpm*State.Ratio;
        Lines.Add(FString::Printf(TEXT("Input %.1f rpm | Output %.3f rpm | Ratio %.4f"),ActualRpm,OutputRpm,State.Ratio));
        Lines.Add(FString::Printf(TEXT("Setpoint %.1f rpm | Prescribed motion (no load solver)"),Rpm));
        Lines.Add(FString::Printf(TEXT("Angle %.2f rad | Output %.3f rad"),InputAngle,State.Output));
        Lines.Add(FString::Printf(TEXT("WaveCos %+.3f | WaveSin %+.3f | Explode %.0f%%"),State.Cos,State.Sin,Explosion*100));
        Lines.Add(bBrakeInstalled?(bBrakePowered?TEXT("Brake installed / powered / released"):TEXT("Brake installed / power off / LOCKED")):TEXT("Brake not installed"));
        Lines.Add(TEXT("Space run | +/- rpm | [ ] step | C section | X explode"));
        Lines.Add(TEXT("B brake power | I install brake | Q/F roll | R zero"));
        Lines.Add(VW::String(Mechanism,TEXT("referenceNotes")));
        }
    }
    else if(PlayerRoot)
    {
        Lines.Add(TEXT("WASD move | E interact | 1-0 choice | Tab chapter"));
        Lines.Add(TEXT("Surface walking only; jumping is unavailable in this adapter."));
        Lines.Add(TEXT("P pause | R reset campaign | Escape close dialogue"));
        const FVirtualWorldProgress* State=Progress.Find(SceneOrder[SceneIndex]);
        if(State)
        {
            Lines.Add(State->bCompleted?TEXT("Chapter completed"):TEXT("Chapter tasks"));
            for(const auto& Value:VW::Array(Metadata,TEXT("tasks")))
            {
                const VW::Json Task=Value->AsObject();
                Lines.Add(FString(State->Flags.Contains(VW::String(Task,TEXT("flag")))?TEXT("[x] "):TEXT("[ ] "))+VW::String(Task,TEXT("label")));
            }
        }
        const FString Near=NearbyInteraction();
        if(!Near.IsEmpty())
        {
            const VW::Json Interaction=VW::Object(Nodes[Near].Metadata,TEXT("interaction"));
            Lines.Add(FString::Printf(TEXT("Nearest: %s (%.1f m)"),*VW::String(Interaction,TEXT("title")),InteractionDistance(Near)/100.));
            if(State&&!VW::Requires(Interaction,State->Flags))
            {
                FString Missing=TEXT("Requires: ");for(const auto& Flag:VW::Array(Interaction,TEXT("requires"))) if(!State->Flags.Contains(Flag->AsString())) Missing+=Flag->AsString()+TEXT(" ");
                Lines.Add(Missing);
            }
        }
    }
    if(bPaused) Lines.Add(TEXT("PAUSED"));
    if(!Notice.IsEmpty()) Lines.Add(Notice);
    if(!Dialogue.IsEmpty()) Lines.Add(Dialogue);
    return Lines;
}

TArray<FVirtualWorldAction> AVirtualWorldRuntime::Actions() const
{
    TArray<FVirtualWorldAction> Result;
    Result.Add({TEXT("import-cad"),TEXT("Import STEP / STP [O]"),!CadProcess.IsValid()});
    if(CadProcess.IsValid()) Result.Add({TEXT("cancel-import"),TEXT("Cancel import"),true});
    if(!FatalError.IsEmpty()||!Metadata) return Result;
    Result.Add({TEXT("pause"),bPaused?TEXT("Resume [P]"):TEXT("Pause [P]"),true});
    Result.Add({TEXT("reset"),Mechanism?TEXT("Zero input [R]"):(PlayerRoot?TEXT("Reset campaign [R]"):TEXT("Frame model [R]")),true});
    if(Mechanism)
    {
        const bool Locked=JointDynamics?(!JointDynamics->snapshot().powered||(JointDynamics->snapshot().installed&&(JointDynamics->snapshot().closure!=0||FString(UTF8_TO_TCHAR(JointDynamics->snapshot().brakePhase))!=TEXT("released")))):bBrakeInstalled&&!bBrakePowered;
        Result.Add({TEXT("run"),bRunning?TEXT("Stop [Space]"):TEXT("Run [Space]"),!Locked||bRunning});
        Result.Add({TEXT("section"),bSection?TEXT("Full housing [C]"):TEXT("Section view [C]"),true});
        Result.Add({TEXT("step-back"),TEXT("Step -15 degrees [ ]"),!Locked&&!bRunning&&!bPaused&&(!JointDynamics||JointDynamics->snapshot().omega==0)});
        Result.Add({TEXT("step"),TEXT("Step +15 degrees [ ]"),!Locked&&!bRunning&&!bPaused&&(!JointDynamics||JointDynamics->snapshot().omega==0)});
        Result.Add({TEXT("speed-down"),TEXT("RPM -1 [-]"),true});Result.Add({TEXT("speed-up"),TEXT("RPM +1 [+]"),true});
        if(JointDynamics)
        {
            Result.Add({TEXT("markers"),bRollingMarkers?TEXT("Hide motion markers [M]"):TEXT("Show motion markers [M]"),true});
            Result.Add({TEXT("principle"),bPrinciple?TEXT("Hide principle [G]"):TEXT("Show principle [G]"),PrincipleMesh!=nullptr});
            Result.Add({TEXT("slow-motion"),FString::Printf(TEXT("Whole clock %.2fx [T]"),JointTimeScale),true});
            Result.Add({TEXT("focus-brake"),TEXT("Brake close-up [K]"),PrincipleMesh!=nullptr});
            Result.Add({TEXT("focus-principle"),TEXT("Principle overview [V]"),PrincipleMesh!=nullptr});
            Result.Add({TEXT("frame-assembly"),TEXT("Frame assembly [H]"),true});
        }
        else Result.Add({TEXT("explode"),TEXT("Explode +25% / reset [X]"),true});
        if(bHasBrake)
        {
            Result.Add({TEXT("brake-install"),bBrakeInstalled?TEXT("Remove brake [I]"):TEXT("Install brake [I]"),true});
            Result.Add({TEXT("brake-power"),bBrakePowered?TEXT("Cut brake power [B]"):TEXT("Power brake [B]"),bBrakeInstalled});
        }
        if(!JointDynamics) for(const auto& Value:VW::Array(Mechanism,TEXT("subsystems")))
        {
            const VW::Json System=Value->AsObject();const FString Id=VW::String(System,TEXT("id")),Name=VW::String(System,TEXT("name"));
            Result.Add({TEXT("hide:")+Id,(HiddenSubsystems.Contains(Id)?TEXT("Show "):TEXT("Hide "))+Name,true});
            Result.Add({TEXT("isolate:")+Id,(IsolatedSubsystem==Id?TEXT("Unisolate "):TEXT("Isolate "))+Name,true});
        }
    }
    else if(PlayerRoot)
    {
        const FString Near=NearbyInteraction();
        if(!Near.IsEmpty()) Result.Add({TEXT("interact"),TEXT("Interact [E]"),InteractionDistance(Near)<=300.});
        if(Nodes.Contains(SelectedInteraction))
        {
            const auto Choices=VW::Array(VW::Object(Nodes[SelectedInteraction].Metadata,TEXT("interaction")),TEXT("choices"));
            for(int32 I=0;I<Choices.Num();++I) Result.Add({TEXT("choice:")+FString::FromInt(I),FString::Printf(TEXT("[%d] %s"),(I+1)%10,*VW::String(Choices[I]->AsObject(),TEXT("label"))),true});
        }
    }
    for(int32 I=0;I<SceneOrder.Num();++I)
        Result.Add({TEXT("scene:")+SceneOrder[I],(I==SceneIndex?TEXT("> "):TEXT(""))+VW::String(Scenes[I],TEXT("name")),IsUnlocked(SceneOrder[I])});
    return Result;
}

AVirtualWorldRuntime* AVirtualWorldHUD::Runtime() const
{
    TActorIterator<AVirtualWorldRuntime> It(GetWorld());
    if(It) return *It;
    return nullptr;
}

void AVirtualWorldHUD::DrawHUD()
{
    Super::DrawHUD();
    AVirtualWorldRuntime* Player=Runtime();if(!Player||!Canvas||!GEngine)return;
    if(LastScene!=Player->SceneIndex) {LastScene=Player->SceneIndex;PanelScroll=0;}
    const float Width=FMath::Min(450.f,Canvas->SizeX*.48f),Top=52,Bottom=Canvas->SizeY-24;
    APlayerController* PC=GetOwningPlayerController();
    float MX=0,MY=0;if(PC)PC->GetMousePosition(MX,MY);
    if(PC&&MX<Width)
    {
        if(PC->WasInputKeyJustPressed(EKeys::MouseScrollDown)) PanelScroll+=60;
        if(PC->WasInputKeyJustPressed(EKeys::MouseScrollUp)) PanelScroll-=60;
    }
    PanelScroll=FMath::Clamp(PanelScroll,0.f,FMath::Max(0.f,ContentHeight-(Bottom-Top)));
    DrawRect(FLinearColor(.025f,.035f,.06f,.94f),0,0,Width,Canvas->SizeY);
    DrawText(TEXT("Unreal Engine | VirtualWorld"),FLinearColor(.85f,.92f,1),16,14,GEngine->GetMediumFont(),1.f);
    DrawText(TEXT("Scroll this panel for all controls"),FLinearColor(.5f,.65f,.8f),16,Canvas->SizeY-20,GEngine->GetSmallFont(),.8f);
    float Y=Top-PanelScroll;
    const auto Line=[&](const FString& Text,FLinearColor Color)
    {
        FString Current;
        const auto Flush=[&]() {if(Y>=Top&&Y+20<=Bottom)DrawText(Current,Color,16,Y,GEngine->GetMediumFont(),.8f);Current.Empty();Y+=22;};
        for(TCHAR C:Text)
        {
            if(C=='\n') {Flush();continue;}
            FString Candidate=Current;Candidate.AppendChar(C);float W=0,H=0;GetTextSize(Candidate,W,H,GEngine->GetMediumFont(),.8f);
            if(W>Width-32&&!Current.IsEmpty()) Flush();
            Current.AppendChar(C);
        }
        if(!Current.IsEmpty()) Flush();
        Y+=6;
    };
    for(const FString& Text:Player->StatusLines()) Line(Text,Player->Error().IsEmpty()?FLinearColor(.9f,.94f,1):FLinearColor(1,.3f,.25f));
    const auto Buttons=Player->Actions();const float ButtonWidth=(Width-42)/2;
    for(int32 I=0;I<Buttons.Num();++I)
    {
        const auto& Button=Buttons[I];const float X=16+(I%2)*(ButtonWidth+10),RowY=Y+(I/2)*40;
        if(RowY<Top||RowY+34>Bottom) continue;
        DrawRect(Button.bEnabled?FLinearColor(.12f,.22f,.34f,1):FLinearColor(.09f,.11f,.14f,1),X,RowY,ButtonWidth,34);
        FString Label=Button.Label;float W=0,H=0;GetTextSize(Label,W,H,GEngine->GetSmallFont(),.9f);
        while(W>ButtonWidth-14&&Label.Len()>3) {Label.LeftChopInline(1);GetTextSize(Label+TEXT("..."),W,H,GEngine->GetSmallFont(),.9f);}
        if(Label!=Button.Label)Label+=TEXT("...");
        DrawText(Label,Button.bEnabled?FLinearColor::White:FLinearColor(.4f,.45f,.5f),X+7,RowY+8,GEngine->GetSmallFont(),.9f);
        if(Button.bEnabled) AddHitBox(FVector2D(X,RowY),FVector2D(ButtonWidth,34),FName(*Button.Id),true);
    }
    ContentHeight=Y+PanelScroll-Top+FMath::CeilToInt(Buttons.Num()/2.f)*40+16;
    if(PC&&Player->PlayerRoot&&!Player->bSmokeRequested)
    {
        for(const auto& Pair:Player->Nodes)
        {
            const VW::Json Interaction=VW::Object(Pair.Value.Metadata,TEXT("interaction"));if(!Interaction||!Pair.Value.bVisible)continue;
            FVector2D Screen;
            if(!PC->ProjectWorldLocationToScreen(Pair.Value.Wrapper->GetComponentLocation()+Player->PlayerUp*25.,Screen)||Screen.X<Width+10||Screen.X>Canvas->SizeX-160||Screen.Y<20||Screen.Y>Canvas->SizeY-50)continue;
            const bool Near=Player->InteractionDistance(Pair.Key)<=300.;
            const FString Label=VW::String(Interaction,TEXT("title"))+FString::Printf(TEXT(" %.1fm"),Player->InteractionDistance(Pair.Key)/100.);
            DrawRect(FLinearColor(.02f,.04f,.08f,.8f),Screen.X-5,Screen.Y-4,200,30);
            DrawText(Label,Near?FLinearColor(1,.82f,.3f):FLinearColor(.7f,.8f,.9f),Screen.X,Screen.Y,GEngine->GetSmallFont(),.8f);
            AddHitBox(Screen-FVector2D(5,4),FVector2D(200,30),FName(*(TEXT("talk:")+Pair.Key)),true);
        }
    }
}

void AVirtualWorldHUD::NotifyHitBoxClick(FName BoxName)
{
    Super::NotifyHitBoxClick(BoxName);
    if(AVirtualWorldRuntime* Player=Runtime()) Player->Command(BoxName.ToString());
}

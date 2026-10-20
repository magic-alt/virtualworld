using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;

namespace VirtualWorld.Editor
{
    /// <summary>Bundle a deterministic font; operating-system fallback is not a build dependency.</summary>
    public static class VirtualWorldFonts
    {
        public const string DefaultPath = "Assets/VirtualWorldFonts/NotoSansCJKsc-Regular.otf";
        const string Help = "Run node Scripts/prepare-font.mjs --project PROJECT before importing, or pass -virtualWorldFont Assets/path/to/a/licensed-CJK-font.otf to the batch method.";
        public static Font Resolve(string path, NativeManifest manifest)
        {
            if (String.IsNullOrEmpty(path) || !path.StartsWith("Assets/", StringComparison.Ordinal) || path.Split('/').Any(part => part == "..") || path.Contains("\\"))
                throw new InvalidDataException("Font must be an asset path inside this project. " + Help);
            string absolute = Path.GetFullPath(Path.Combine(Application.dataPath, path.Substring("Assets/".Length)));
            if (!absolute.StartsWith(Path.GetFullPath(Application.dataPath) + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                throw new InvalidDataException("Font asset escapes this project's Assets directory.");
            if (!File.Exists(absolute)) throw new FileNotFoundException("Bundled UI font is missing: " + path + ". " + Help);
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var importer = AssetImporter.GetAtPath(path) as TrueTypeFontImporter;
            if (importer == null) throw new InvalidDataException("Expected an imported .otf or .ttf UI font: " + path);
            if (!importer.includeFontData || importer.fontTextureCase != FontTextureCase.Dynamic)
            {
                importer.includeFontData = true;
                importer.fontTextureCase = FontTextureCase.Dynamic;
                importer.SaveAndReimport();
            }
            var font = AssetDatabase.LoadAssetAtPath<Font>(path);
            Validate(font, manifest);
            return font;
        }
        public static TextAsset License(Font font)
        {
            string fontPath = AssetDatabase.GetAssetPath(font);
            string path = Path.GetDirectoryName(fontPath).Replace('\\', '/') + "/OFL.txt";
            string absolute = Path.Combine(Application.dataPath, path.Substring("Assets/".Length));
            if (File.Exists(absolute))
            {
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                return AssetDatabase.LoadAssetAtPath<TextAsset>(path);
            }
            if (fontPath == DefaultPath) throw new FileNotFoundException("The pinned Noto font's OFL.txt license is missing. " + Help);
            return null;
        }
        public static void Validate(Font font, NativeManifest manifest)
        {
            if (font == null) throw new InvalidDataException("Catalog has no bundled UI font. " + Help);
            var importer = AssetImporter.GetAtPath(AssetDatabase.GetAssetPath(font)) as TrueTypeFontImporter;
            if (importer == null || !importer.includeFontData || importer.fontTextureCase != FontTextureCase.Dynamic)
                throw new InvalidDataException("UI font must embed its font data and use Dynamic character rendering. " + Help);
            var required = new HashSet<char>(Enumerable.Range(32, 95).Select(value => (char)value));
            foreach (string text in DisplayedText(manifest))
                foreach (char character in text ?? "") if (!Char.IsControl(character) && !Char.IsWhiteSpace(character)) required.Add(character);
            var missing = required.Where(character => Char.IsSurrogate(character) || !font.HasCharacter(character)).OrderBy(character => character).ToArray();
            if (missing.Length > 0)
                throw new InvalidDataException("Bundled UI font does not cover " + missing.Length + " required glyphs: " +
                    String.Join(", ", missing.Take(16).Select(character => "U+" + ((int)character).ToString("X4"))) + ". " + Help);
        }
        static IEnumerable<string> DisplayedText(NativeManifest manifest)
        {
            yield return "·✓○↑←↓→−";
            if (manifest.campaign != null)
            {
                yield return manifest.campaign.title;
                foreach (var chapter in manifest.campaign.chapters ?? Array.Empty<CampaignChapter>()) yield return chapter.title;
            }
            foreach (var scene in manifest.scenes)
            {
                yield return scene.name;
                var spec = scene.ReadSpec();
                yield return spec.name; yield return spec.description;
                foreach (var task in spec.tasks) yield return task.label;
                foreach (var node in spec.nodes)
                {
                    yield return node.name;
                    if (node.interaction == null) continue;
                    yield return node.interaction.title; yield return node.interaction.text;
                    foreach (var choice in node.interaction.choices ?? Array.Empty<DialogueChoice>()) { yield return choice.label; yield return choice.text; }
                }
                if (spec.mechanism == null) continue;
                yield return spec.mechanism.referenceNotes;
                foreach (var subsystem in spec.mechanism.subsystems ?? Array.Empty<MechanismSubsystem>()) { yield return subsystem.name; yield return subsystem.description; }
            }
        }
    }
}

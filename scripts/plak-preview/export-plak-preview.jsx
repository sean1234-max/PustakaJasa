// Plak preview export (Sean, 2026-11-02). Run by export-plak-preview.sh in Illustrator, on COPIES of the
// AI FILE templates: for every .ai it writes what the website's plak preview needs and nothing else —
//   - each layout group (T_H_PC_L1 …) with an ANCHOR_CIRCLE: the anchor's size and every text frame's box
//     (pt, around the anchor's centre, y up), justification, font and size (the Chinese TC_ ones keep
//     their own; the latin ones get SEAN.jsx's house style on the website)
//   - the plaque picture: BACKGROUND_1 (or the first BACKGROUND_…) as a PNG, else the ANCHOR_CIRCLE outline
// into manifest.json + PNGs in PRESET_OUT. The .ai files are opened, read and closed without saving.
// PRESET_SRC / PRESET_OUT are put in front of this file by the .sh. With PRESET_DESIGN_FILE instead (the AI File
// helper's /medal-designs) it reads E CUT 0's medal designs — see "medal designs" below.

var ANCHOR = "ANCHOR_CIRCLE";
var FIELDS = { event_header: 1, year: 1, position: 1, event_line_1: 1, event_line_2: 1, event_line_3: 1,
    RANK_YELLOW: 1, RANK_GREY: 1, RANK_BROWN: 1 };
var PARTS = { H: 1, Y: 1, PC: 1, L1: 1, L2: 1, L3: 1 };
var MAX_PNG_PX = 700;

// same check as SEAN.jsx isTemplateName (no regex: Illustrator's hangs on a near-miss)
function isTemplateName(name) {
    var parts = String(name).split("_");
    if (parts.length < 2 || (parts[0] !== "T" && parts[0] !== "TC")) return false;
    for (var i = 1; i < parts.length; i++) if (!PARTS.hasOwnProperty(parts[i])) return false;
    return true;
}

// as SEAN.jsx (2026-11-18): an OLD… group is put away (skipped with everything inside it); MASTER_TEMPLATE is
// the file's T_H_Y_PC_L1_L2. TEXT_AREA: the rectangle the text stack is fitted in (never printed).
function isOldGroup(item) { return /^OLD/i.test(String(item.name)); }
function templateNameOf(item) { return item.name === "MASTER_TEMPLATE" ? "T_H_Y_PC_L1_L2" : item.name; }
var TEXT_AREA = "TEXT_AREA";
function findNamed(group, name) {
    for (var i = 0; i < group.pageItems.length; i++) {
        var it = group.pageItems[i];
        if (it.name === name) return it;
        if (it.typename === "GroupItem") { var inner = findNamed(it, name); if (inner) return inner; }
    }
    return null;
}

function json(v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number") return isFinite(v) ? String(Math.round(v * 100) / 100) : "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string") {
        return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r\n|\r|\n/g, "\\n")
            .replace(/[\u0000-\u001f]/g, " ") + '"';
    }
    var out = [];
    if (v instanceof Array) {
        for (var i = 0; i < v.length; i++) out.push(json(v[i]));
        return "[" + out.join(",") + "]";
    }
    for (var k in v) if (v.hasOwnProperty(k)) out.push(json(k) + ":" + json(v[k]));
    return "{" + out.join(",") + "}";
}

function hex2(n) { var s = Math.max(0, Math.min(255, Math.round(n))).toString(16); return s.length < 2 ? "0" + s : s; }
function colorHex(c) {
    try {
        if (!c) return null;
        if (c.typename === "SpotColor") return colorHex(c.spot.color);
        if (c.typename === "RGBColor") return "#" + hex2(c.red) + hex2(c.green) + hex2(c.blue);
        if (c.typename === "GrayColor") { var g = 255 * (1 - c.gray / 100); return "#" + hex2(g) + hex2(g) + hex2(g); }
        if (c.typename === "CMYKColor") {
            var k = 1 - c.black / 100;
            return "#" + hex2(255 * (1 - c.cyan / 100) * k) + hex2(255 * (1 - c.magenta / 100) * k) + hex2(255 * (1 - c.yellow / 100) * k);
        }
    } catch (e) {}
    return null;
}

function justify(j) {
    var s = String(j);
    if (/RIGHT/.test(s)) return "right";
    if (/LEFT/.test(s) && !/FULLJUSTIFYLASTLINE/.test(s)) return "left";
    return "center";
}

function childNamed(group, name) {
    for (var i = 0; i < group.pageItems.length; i++) if (group.pageItems[i].name === name) return group.pageItems[i];
    return null;
}

function collectTextFrames(group, out) {
    for (var i = 0; i < group.pageItems.length; i++) {
        var it = group.pageItems[i];
        if (it.typename === "TextFrame" && FIELDS.hasOwnProperty(it.name) && !out[it.name]) out[it.name] = it;
        else if (it.typename === "GroupItem" && !isOldGroup(it)) collectTextFrames(it, out);
    }
}

function collectTemplates(items, out) {
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.typename !== "GroupItem" || isOldGroup(it)) continue;
        var tname = templateNameOf(it);
        if (isTemplateName(tname)) {
            if (!out[tname] && childNamed(it, ANCHOR)) out[tname] = it;
        } else {
            collectTemplates(it.pageItems, out);
        }
    }
}

function findBackground(items) {
    var first = null;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (/^BACKGROUND_/.test(it.name)) {
            if (it.name === "BACKGROUND_1") return it;
            if (!first) first = it;
        }
        if (it.typename === "GroupItem" && !isOldGroup(it) && !isTemplateName(templateNameOf(it))) {
            var inner = findBackground(it.pageItems);
            if (inner && (inner.name === "BACKGROUND_1" || !first)) {
                if (inner.name === "BACKGROUND_1") return inner;
                first = inner;
            }
        }
    }
    return first;
}

function readTemplate(group) {
    var ab = childNamed(group, ANCHOR).geometricBounds;
    var cx = (ab[0] + ab[2]) / 2, cy = (ab[1] + ab[3]) / 2;
    var frames = {};
    collectTextFrames(group, frames);
    var fields = {};
    for (var name in frames) {
        if (!frames.hasOwnProperty(name)) continue;
        var tf = frames[name];
        var gb = tf.geometricBounds;
        var f = { box: [gb[0] - cx, gb[1] - cy, gb[2] - cx, gb[3] - cy] };
        try {
            var ca = tf.textRange.characterAttributes;
            f.font = ca.textFont.name;
            f.size = ca.size;
            f.leading = ca.autoLeading ? ca.size * 1.2 : ca.leading;
            f.tracking = ca.tracking;
            f.color = colorHex(ca.fillColor);
            f.justify = justify(tf.textRange.paragraphAttributes.justification);
            if (tf.kind === TextType.PATHTEXT) f.path = true; // a round medal's arc
        } catch (e) {}
        fields[name] = f;
    }
    var res = { anchor: [ab[2] - ab[0], ab[1] - ab[3]], centre: [cx, cy], fields: fields };
    var area = findNamed(group, TEXT_AREA);
    if (area) { var g = area.geometricBounds; res.textArea = [g[0] - cx, g[1] - cy, g[2] - cx, g[3] - cy]; }
    return res;
}

// Copies `item` into a new RGB document of its own and saves it as a PNG at most MAX_PNG_PX wide; returns
// its [width, height]. Like SEAN.jsx makeBackgroundFor: a background's own ANCHOR_CIRCLE is dropped and only
// its yellow rank version (BG_YELLOW) shown; SEAN.jsx then centres it on each plaque's anchor.
function exportPng(item, file, asOutline) {
    var tmp = app.documents.add(DocumentColorSpace.RGB, 500, 500);
    try {
        var dup = item.duplicate(tmp.layers[0], ElementPlacement.PLACEATBEGINNING);
        dup.hidden = false;
        if (dup.typename === "GroupItem") {
            for (var i = dup.pageItems.length - 1; i >= 0; i--) {
                var c = dup.pageItems[i];
                if (c.name === ANCHOR) c.remove();
                else if (c.name === "BG_GREY" || c.name === "BG_BROWN") c.hidden = true;
                else if (c.name === "BG_YELLOW") c.hidden = false;
            }
        }
        if (asOutline) {
            // black like the cut line it stands for (Sean, 2026-11-02: H25-1 / JZ 19821 have no background)
            var black = new RGBColor(); black.red = 0; black.green = 0; black.blue = 0;
            dup.filled = false; dup.stroked = true; dup.strokeColor = black; dup.strokeWidth = 1.5;
        }
        var vb = dup.visibleBounds;
        var w = vb[2] - vb[0], h = vb[1] - vb[3];
        tmp.artboards[0].artboardRect = vb;
        var opts = new ExportOptionsPNG24();
        var scale = Math.min(300, MAX_PNG_PX * 100 / Math.max(w, 1));
        opts.horizontalScale = scale; opts.verticalScale = scale;
        opts.transparency = true; opts.artBoardClipping = true; opts.antiAliasing = true;
        tmp.exportFile(file, ExportType.PNG24, opts);
        return [w, h];
    } finally {
        tmp.close(SaveOptions.DONOTSAVECHANGES);
    }
}

// A layout group's own artwork, drawn with every plaque (Sean, 2026-11-02: E TROFI 13228 B's black frame
// pattern): what's in it besides the text frames and the ANCHOR_CIRCLE, shown, and not a group of text frames
function hasFieldText(item) {
    if (item.typename === "TextFrame") return FIELDS.hasOwnProperty(item.name);
    if (item.typename !== "GroupItem") return false;
    for (var i = 0; i < item.pageItems.length; i++) if (hasFieldText(item.pageItems[i])) return true;
    return false;
}
function artOf(group) {
    var art = [];
    for (var i = 0; i < group.pageItems.length; i++) {
        var it = group.pageItems[i];
        if (it.parent !== group || it.hidden || it.name === ANCHOR || it.name === TEXT_AREA || isOldGroup(it)
            || it.typename === "TextFrame" || hasFieldText(it)) continue;
        art.push(it);
    }
    return art;
}
// those items as one PNG -> their box (pt) around the anchor centre (cx, cy), y up
function exportArt(items, file, cx, cy) {
    var tmp = app.documents.add(DocumentColorSpace.RGB, 500, 500);
    try {
        // measured where they are in the .ai (the anchor's coordinates); the copy only makes the picture
        var join = function (u, vb) { return u ? [Math.min(u[0], vb[0]), Math.max(u[1], vb[1]), Math.max(u[2], vb[2]), Math.min(u[3], vb[3])] : vb; };
        var u = null, d = null;
        for (var i = 0; i < items.length; i++) {
            u = join(u, items[i].visibleBounds);
            d = join(d, items[i].duplicate(tmp.layers[0], ElementPlacement.PLACEATEND).visibleBounds);
        }
        tmp.artboards[0].artboardRect = d;
        var opts = new ExportOptionsPNG24();
        var scale = Math.min(300, MAX_PNG_PX * 100 / Math.max(d[2] - d[0], 1));
        opts.horizontalScale = scale; opts.verticalScale = scale;
        opts.transparency = true; opts.artBoardClipping = true; opts.antiAliasing = true;
        tmp.exportFile(file, ExportType.PNG24, opts);
        return [u[0] - cx, u[1] - cy, u[2] - cx, u[3] - cy];
    } finally {
        tmp.close(SaveOptions.DONOTSAVECHANGES);
    }
}

function slug(name) { return String(name).replace(/\.ai$/i, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

function exportFile(f, outFolder, log) {
    var name = decodeURI(f.name);
    var doc = app.open(f);
    try {
        for (var L = 0; L < doc.layers.length; L++) { doc.layers[L].locked = false; doc.layers[L].visible = true; }
        var groups = {};
        for (var l = 0; l < doc.layers.length; l++) collectTemplates(doc.layers[l].pageItems, groups);
        var templates = {}, count = 0, firstAnchor = null;
        for (var t in groups) {
            if (!groups.hasOwnProperty(t)) continue;
            templates[t] = readTemplate(groups[t]);
            if (!firstAnchor) firstAnchor = childNamed(groups[t], ANCHOR);
            count++;
        }
        if (!count) { log.push(name + ": no layout groups, skipped"); return null; }
        var entry = { file: name, templates: templates, picture: null };
        var bgItems = [];
        for (var b = 0; b < doc.layers.length; b++) bgItems.push(findBackground(doc.layers[b].pageItems));
        var bg = null;
        for (var bi = 0; bi < bgItems.length && !bg; bi++) bg = bgItems[bi];
        var png = slug(name) + ".png";
        var size = exportPng(bg || firstAnchor, new File(outFolder.fsName + "/" + png), !bg);
        entry.picture = { png: png, outline: !bg, box: [-size[0] / 2, size[1] / 2, size[0] / 2, -size[1] / 2] };
        var arts = 0;
        for (var k in templates) {
            if (!templates.hasOwnProperty(k)) continue;
            var art = artOf(groups[k]);
            if (art.length) {
                var artPng = slug(name) + "-" + k + ".png";
                templates[k].art = { png: artPng, box: exportArt(art, new File(outFolder.fsName + "/" + artPng), templates[k].centre[0], templates[k].centre[1]) };
                arts++;
            }
            delete templates[k].centre;
        }
        log.push(name + ": " + count + " layout group(s), picture " + (bg ? bg.name : "outline") + (arts ? ", artwork in " + arts : ""));
        return entry;
    } finally {
        doc.close(SaveOptions.DONOTSAVECHANGES);
    }
}

// ------------------------------------------------------------------ medal designs (Sean, 2026-11-24)
// E CUT 0 holds every medal design, each a group named "DESIGN <n>" with its layout groups inside (MELAYU /
// CHINESE containers are fine). PRESET_DESIGN_FILE set → only that .ai, one entry per DESIGN group: its layout
// groups (as above), its background, and a picture of how it looks — its fullest Malay layout group drawn on the
// background as it is in the .ai (its own sample words), the background at SEAN.jsx's MEDAL_BG_OPACITY, clipped
// to the ANCHOR_CIRCLE. -> designs.json + PNGs in PRESET_OUT.
var MEDAL_BG_OPACITY = 20; // SEAN.jsx MEDAL_BG_OPACITY — change both
var THUMB_PX = 400;

// "DESIGN 3" (any case, one space or more) — no regex on the whole name (see isTemplateName)
function designNameOf(item) {
    var parts = String(item.name).replace(/^\s+|\s+$/g, "").split(/\s+/);
    return parts.length === 2 && parts[0].toUpperCase() === "DESIGN" && /^\d+$/.test(parts[1]) ? "DESIGN " + Number(parts[1]) : null;
}

function collectDesigns(items, out) {
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.typename !== "GroupItem" || isOldGroup(it) || isTemplateName(templateNameOf(it))) continue;
        if (designNameOf(it)) out.push(it);
        else collectDesigns(it.pageItems, out);
    }
}

// the design's Malay (T_) layout group with the most lines, else its fullest Chinese one
function mainTemplateName(templates) {
    var best = null;
    for (var t in templates) {
        if (!templates.hasOwnProperty(t)) continue;
        var score = (t.indexOf("T_") === 0 ? 100 : 0) + t.split("_").length;
        if (!best || score > best.score) best = { name: t, score: score };
    }
    return best ? best.name : null;
}

function centreOf(b) { return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }

// a background's own circle (its widest round path), else the whole background — what SEAN.jsx centres on
function backgroundCentre(bg) {
    var best = null;
    if (bg.typename === "GroupItem") {
        for (var i = 0; i < bg.pageItems.length; i++) {
            var p = bg.pageItems[i];
            if (p.typename !== "PathItem") continue;
            var b = p.geometricBounds, w = b[2] - b[0], h = b[1] - b[3];
            if (w > 0 && Math.abs(w - h) < w * 0.02 && (!best || w > best.w)) best = { w: w, c: centreOf(b) };
        }
    }
    return best ? best.c : centreOf(bg.geometricBounds);
}

// (measured on the copies: a copy in another document doesn't keep the original's coordinates)
function exportThumb(group, bg, file) {
    var tmp = app.documents.add(DocumentColorSpace.RGB, 500, 500);
    try {
        var layer = tmp.layers[0];
        var dup = group.duplicate(layer, ElementPlacement.PLACEATBEGINNING);
        var ab = childNamed(dup, ANCHOR).geometricBounds;
        if (bg) {
            var bgDup = bg.duplicate(layer, ElementPlacement.PLACEATEND);
            bgDup.hidden = false;
            var from = backgroundCentre(bgDup), to = centreOf(ab);
            bgDup.translate(to[0] - from[0], to[1] - from[1]);
            bgDup.opacity = MEDAL_BG_OPACITY;
            var clip = layer.pathItems.ellipse(ab[1], ab[0], ab[2] - ab[0], ab[1] - ab[3]);
            var masked = layer.groupItems.add();
            masked.move(layer, ElementPlacement.PLACEATEND); // under the words
            bgDup.move(masked, ElementPlacement.PLACEATEND);
            clip.move(masked, ElementPlacement.PLACEATBEGINNING);
            masked.clipped = true;
        }
        var area = findNamed(dup, TEXT_AREA);
        if (area) area.remove();
        // one position only: the first shown of RANK_YELLOW / GREY / BROWN (E CUT 0's arc master shows all three)
        var shown = false, ranks = ["RANK_YELLOW", "RANK_GREY", "RANK_BROWN"];
        for (var r = 0; r < ranks.length; r++) {
            var rank = findNamed(dup, ranks[r]);
            if (!rank || rank.hidden) continue;
            if (shown) rank.hidden = true;
            shown = true;
        }
        var pad = 2;
        tmp.artboards[0].artboardRect = [ab[0] - pad, ab[1] + pad, ab[2] + pad, ab[3] - pad];
        var opts = new ExportOptionsPNG24();
        var scale = Math.min(600, THUMB_PX * 100 / Math.max(ab[2] - ab[0] + 2 * pad, 1));
        opts.horizontalScale = scale; opts.verticalScale = scale;
        opts.transparency = true; opts.artBoardClipping = true; opts.antiAliasing = true;
        tmp.exportFile(file, ExportType.PNG24, opts);
    } finally {
        tmp.close(SaveOptions.DONOTSAVECHANGES);
    }
}

function exportDesign(design, docBg, outFolder, log) {
    var name = designNameOf(design);
    var groups = {};
    collectTemplates(design.pageItems, groups);
    var templates = {}, count = 0;
    for (var t in groups) {
        if (!groups.hasOwnProperty(t)) continue;
        templates[t] = readTemplate(groups[t]);
        count++;
    }
    if (!count) { log.push(name + ": FAILED no layout group (T_… / TC_… with an ANCHOR_CIRCLE) inside"); return null; }
    var bg = findBackground(design.pageItems) || docBg;
    var key = slug(name);
    var entry = { design: name, templates: templates, picture: null, thumb: key + "-thumb.png", main: mainTemplateName(templates) };
    if (bg) {
        var size = exportPng(bg, new File(outFolder.fsName + "/" + key + "-bg.png"), false);
        entry.picture = { png: key + "-bg.png", outline: false, box: [-size[0] / 2, size[1] / 2, size[0] / 2, -size[1] / 2] };
    }
    for (var k in templates) {
        if (!templates.hasOwnProperty(k)) continue;
        var art = artOf(groups[k]);
        if (art.length) {
            var artPng = key + "-" + k + ".png";
            templates[k].art = { png: artPng, box: exportArt(art, new File(outFolder.fsName + "/" + artPng), templates[k].centre[0], templates[k].centre[1]) };
        }
        delete templates[k].centre;
    }
    exportThumb(groups[entry.main], bg, new File(outFolder.fsName + "/" + entry.thumb));
    log.push(name + ": " + count + " layout group(s), picture from " + entry.main + (bg ? " on " + bg.name : " (no background)"));
    return entry;
}

function exportDesigns(f, outFolder, log) {
    var doc = app.open(f);
    try {
        for (var L = 0; L < doc.layers.length; L++) { doc.layers[L].locked = false; doc.layers[L].visible = true; }
        var found = [];
        for (var l = 0; l < doc.layers.length; l++) collectDesigns(doc.layers[l].pageItems, found);
        var docBg = null;
        for (var b = 0; b < doc.layers.length && !docBg; b++) docBg = findBackground(doc.layers[b].pageItems);
        var entries = [], seen = {};
        for (var i = 0; i < found.length; i++) {
            var n = designNameOf(found[i]);
            if (seen[n]) { log.push(n + ": FAILED two groups are named " + n + " — rename one"); continue; }
            seen[n] = true;
            try {
                var e = exportDesign(found[i], docBg, outFolder, log);
                if (e) entries.push(e);
            } catch (err) {
                log.push(n + ": FAILED " + err.message + " (line " + err.line + ")");
            }
        }
        if (!found.length) log.push(decodeURI(f.name) + ": FAILED no group named DESIGN 1, DESIGN 2 …");
        return entries;
    } finally {
        doc.close(SaveOptions.DONOTSAVECHANGES);
    }
}

function writeText(folder, name, text) {
    var file = new File(folder.fsName + "/" + name);
    file.encoding = "UTF-8"; file.open("w"); file.write(text); file.close();
}

function designsMain() {
    var out = new Folder(PRESET_OUT);
    if (!out.exists) out.create();
    var prevInteraction = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    var designs = [], log = [];
    try {
        designs = exportDesigns(new File(PRESET_DESIGN_FILE), out, log);
    } catch (err) {
        log.push("FAILED " + err.message + " (line " + err.line + ")");
    } finally {
        app.userInteractionLevel = prevInteraction;
    }
    writeText(out, "designs.json", json({ designs: designs }));
    writeText(out, "export-log.txt", log.join("\n"));
}

function main() {
    var src = new Folder(PRESET_SRC), out = new Folder(PRESET_OUT);
    if (!out.exists) out.create();
    var prevInteraction = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    var files = src.getFiles(function (f) { return f instanceof File && /\.ai$/i.test(f.name); });
    var entries = [], log = [];
    try {
        for (var i = 0; i < files.length; i++) {
            try {
                var e = exportFile(files[i], out, log);
                if (e) entries.push(e);
            } catch (err) {
                log.push(decodeURI(files[i].name) + ": FAILED " + err.message + " (line " + err.line + ")");
            }
        }
    } finally {
        app.userInteractionLevel = prevInteraction;
    }
    var m = new File(out.fsName + "/templates.json");
    m.encoding = "UTF-8"; m.open("w"); m.write(json({ files: entries })); m.close();
    var lf = new File(out.fsName + "/export-log.txt");
    lf.encoding = "UTF-8"; lf.open("w"); lf.write(log.join("\n")); lf.close();
}

if (typeof PRESET_DESIGN_FILE !== "undefined") designsMain(); else main();

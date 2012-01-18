/**
 * Show a split view; two editors next to each other in one tab
 *
 * @copyright 2010, Ajax.org B.V.
 * @author Mike de Boer <mike AT c9 DOT io>
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */

define(function(require, exports, module) {

var ide = require("core/ide");
var Grids = require("ext/splitview/grids");
var ZManager = require("ext/splitview/zmanager");
var Editors = require("ext/editors/editors");
var SearchReplace = require("ext/searchreplace/searchreplace");
var HashHandler = require("ace/keyboard/hash_handler").HashHandler;
var Splits = [];
var EditorClones = {};
var ActiveClass = "splitview_active";
var InactiveClass = "splitview_inactive";
var NPlusOneClass = "splitview_nplus1";
var SplitView, ActiveSplit;

exports.init = function(splitView) {
    SplitView = splitView;
    
    ide.addEventListener("keybindingschange", function(e) {
        var bindings = e.keybindings;
        
        // make sure this function is executed AFTER all other editors changed 
        // their keybindings
        setTimeout(function() {
            for (var id in EditorClones) {
                if (!EditorClones.hasOwnProperty(id) || !EditorClones[id].length)
                    continue;
    
                EditorClones[id].forEach(function(editor) {
                    if (!editor.$editor || id.indexOf("codeeditor") == -1)
                        return;
                    
                    var config = previousEditor 
                        ? previousEditor.$editor.getKeyboardHandler() 
                        : new HashHandler(bindings.code);
                    editor.$editor.setKeyboardHandler(config);
                });
            }
        });
    });
    
    ide.addEventListener("ext.quicksearch.correctpos", function(e) {
        e.returnValue = correctQuickSearchDialog(e);
    });
    
    ide.addEventListener("ext.gotoline.correctpos", function(e) {
        e.returnValue = correctGotoLineDialog(e);
    });
    
    ide.addEventListener("ext.vim.toggle", function(e) {
        e.returnValue = correctVimMode(e);
    });
    
    Grids.addEventListener("resize", function(e, node) {
        var correct;
        if (searchWindow && searchWindow.visible) {
            correct = correctQuickSearchDialog();
            if (!correct)
                return;
            if (typeof correct.top != "undefined")
                searchWindow.$ext.style.top = correct.top + "px";
            if (typeof correct.right != "undefined")
                searchWindow.$ext.style.right = correct.right + "px";
        }
        if (gotoLineWindow && gotoLineWindow.visible) {
            var ace = Editors.currentEditor.amlEditor.$editor;
            var cursor = ace.getCursorPosition();
            var pos = ace.renderer.textToScreenCoordinates(cursor.row, cursor.column);
            correct = correctGotoLineDialog({ pos:pos });
            if (!correct)
                return;
            if (typeof correct.top != "undefined")
                gotoLineWindow.$ext.style.top = correct.top + "px";
            if (typeof correct.left != "undefined")
                gotoLineWindow.$ext.style.left = correct.left + "px";
        }
    });
    
    return this;
};

exports.create = function(page, gridLayout) {
    gridLayout = Grids.init(gridLayout);
    
    var editor = page.$editor.amlEditor;
    editor.setAttribute("model", page.$model);
    editor.setAttribute("actiontracker", page.$at);
    exports.consolidateEditorSession(page, editor);
    
    var split = {
        pairs: [{
            page: page,
            editor: editor
        }],
        activePage: 0,
        gridLayout: gridLayout,
        zManager: new ZManager()
    };
    Splits.push(split);
    
    return split;
};

exports.show = function(split) {
    if (!split || split === ActiveSplit)
        return this;

    this.update(split);
    if (ActiveSplit)
        this.hide(ActiveSplit, ActiveSplit.gridLayout == split.gridLayout);
    Grids.show(split.gridLayout);
    
    var i, l;
    // maintain page button styles
    Splits.forEach(function(aSplit) {
        if (aSplit === split)
            return;
        for (i = 0, l = aSplit.pairs.length; i < l; ++i)
            aSplit.pairs[i].page.$deactivateButton();
    });
    //console.log("pages",split.pairs.map(function(pair){return pair.page.name;}));
    for (i = 0, l = split.pairs.length; i < l; ++i) {
        split.pairs[i].page.$activateButton();
        split.pairs[i].editor.show();
        exports.consolidateEditorSession(split.pairs[i].page, split.pairs[i].editor);
    }
    
    ActiveSplit = split;
    
    return this;
};

exports.hide = function(split, notGrid) {
    split = split || ActiveSplit;
    if (!notGrid)
        Grids.hide(split.gridLayout);
    var i, l;
    for (i = 0, l = split.pairs.length; i < l; ++i) {
        split.pairs[i].page.$deactivateButton();
        split.pairs[i].editor.hide();
    }
    if (split === ActiveSplit)
        ActiveSplit = null;
    
    if (previousEditor) {
        Editors.currentEditor.amlEditor = previousEditor;
        // invalidate search-replace's cache of the editor object
        delete SearchReplace.$editor;
    }

    return this;
};

exports.update = function(split, gridLayout) {
    split = split || ActiveSplit;
    if (!split)
        return;
    gridLayout = Grids.init(gridLayout || split.gridLayout);

    var page = split.pairs[0].page;
    var amlPage = page.fake ? page.relPage : page;
    split.gridLayout = gridLayout;
    
    // destroy the split view if it contains NOT more than 1 editor.
    //console.log("number of pages in split view:", split.pairs.length,"vs editors:", 
    //  split.editors.length,page.name,split.pages.map(function(page){return page.name}));
    if (split.pairs.length === 1) {
        var editor = page.$editor.amlEditor;
        if (EditorClones[editor.localName]) {
            for (var clone, i = 0, l = EditorClones[editor.localName].length; i < l; ++i) {
                clone = EditorClones[editor.localName][i];
                clone.hide();
                apf.document.body.appendChild(clone);
            }
        }

        editor.removeAttribute("model");
        editor.removeAttribute("actiontracker");
        amlPage.appendChild(editor);
        editor.show();
        
        split.zManager.clear(editor.$ext);
        
        clearSplitViewStyles(page);
        Grids.hide(split.gridLayout);
        
        if (ActiveSplit === split)
            ActiveSplit = null;
        Splits.remove(split);
        //console.log("split removed",Splits);
        // split removed, use the escape hatch...
        return this;
    }
    
    // make sure current grid is the only one visible.
    Grids.show(gridLayout);
    
    // sort the editors and pages before being added to the grid
    sortEditorsAndPages(split);
    //console.log("split editors:", split.pairs.length, split.pairs.map(function(pair) { return pair.editor.id; }));
    Grids.update(gridLayout, split);
    // make sure visual styles are OK
    setSplitViewStyles(split);
    split.zManager.resetAll(split.pairs.map(function(pair) {
        return pair.editor.$ext;
    }).reverse());
    
    exports.setActivePage(split);
    
    // make sure the buttons of the pages in the active split are highlighted
    if (split === ActiveSplit) {
        for (var i = 0, l = split.pairs.length; i < l; ++i)
            split.pairs[i].page.$activateButton();
    }
    
    return this;
};

exports.mutate = function(split, page) {
    split = split || split === null ? ActiveSplit : null;
    var tabs = tabEditors;
    var activePage = tabs.getPage();
    var pairIdx = split ? exports.indexOf(split, page) : -1;

    // Remove an editor from the split view
    if (pairIdx > -1) {
        if (split.clone && split.clone === page)
            SplitView.endCloneView(page);

        var editor = split.pairs[pairIdx].editor;
        
        split.pairs.splice(pairIdx, 1);
        
        editor.removeAttribute("model");
        editor.removeAttribute("actiontracker");
        //removeEditorListeners(editor);
        editor.hide();
        apf.document.body.appendChild(editor);
        
        page.$deactivateButton();
        clearSplitViewStyles(page);
        editor.hide();
        split.zManager.clear(editor.$ext);
        if (tabs.getPage() !== split.pairs[0].page)
            tabs.set(split.pairs[0].page);

        this.update(split);
    }
    // Add an editor to the split view
    else if (!split || split.pairs.length < 3) {
        var clones = createEditorClones.call(this, page.$editor.amlEditor);
        
        if (!split) {
            // create the split view, with the currently active tab as first page
            // and editor
            if (page === activePage)
                return true;

            split = this.create(activePage);
        }
        
        var editorToUse;
        if (split.clone && page === split.clone) {
            editorToUse = EditorClones.cloneEditor;
        }
        else {
            for (var i = 0, l = clones.length; i < l; ++i) {
                if (exports.indexOf(split, clones[i]) == -1) {
                    editorToUse = clones[i];
                    break;
                }
            }
        }
        if (!editorToUse && exports.indexOf(split, clones.original) == -1)
            editorToUse = clones.original;
        
        if (!editorToUse)
            throw new Error("Splitview fatal error: no editor available to use.");
        
        split.pairs.push({
            page: page,
            editor: editorToUse
        });
        //console.log("setting model of ", editorToUse.id, "to", page.$model.data.xml);
        exports.consolidateEditorSession(page, editorToUse);
        split.zManager.set(editorToUse.$ext);

        this.show(split);
    }
    
    return true;
};

exports.get = function(amlNode) {
    if (!amlNode)
        return [].concat(Splits);
    
    var split;
    var i = 0;
    var l = Splits.length;
    var splits = [];

    for (; i < l; ++i) {
        split = Splits[i];
        if (!split || exports.indexOf(split, amlNode) === -1)
            continue;
        splits.push(split);
    }

    return splits;
};

exports.is = function(amlNode) {
    return !!this.get(amlNode);
};

exports.isActive = function(split) {
    return split === ActiveSplit;
};

exports.getActive = function() {
    return ActiveSplit || null;
};

exports.setActivePage = function(split, page) {
    var old = split.activePage;
    var idx = split.activePage = page
        ? exports.indexOf(split, page) 
        : split.activePage;
    if (idx == -1)
        return;
    var pair = split.pairs[idx] ? split.pairs[idx] : split.pairs[0];
    pair.editor.focus();
    if (idx !== old)
        ide.dispatchEvent("pageswitch", { page: pair.page });
};

/*
 * Implemented this function, because Array.indexOf() compares objects with '=='
 * instead of '==='!
 */
exports.indexOf = function(split, obj) {
    var type = obj.localName.indexOf("page") > -1 ? "page" : "editor";
    for (var i = 0, l = split.pairs.length; i < l; ++i) {
        if (split.pairs[i][type] === obj)
            return i;
    }
    return -1;
};

function sortEditorsAndPages(split) {
    var pages = tabEditors.getPages();
    split.pairs.sort(function(pair1, pair2) {
        var idx1 = pages.indexOf(pair1.page);
        var idx2 = pages.indexOf(pair2.page);
        return idx1 > idx2 ? 1 : idx1 < idx2 ? -1 : 0;
    });
}

function createEditorClones(editor) {
    var id = editor.localName;
    var isCodeEditor = id.indexOf("codeeditor") > -1;

    if (!EditorClones.cloneEditor && isCodeEditor) {
        if (!previousEditor)
            previousEditor = editor;
        EditorClones.cloneEditor = editor.cloneNode(true);
        EditorClones.cloneEditor.removeAttribute("id");
        EditorClones.cloneEditor.setAttribute("visible", "false");
        apf.document.body.appendChild(EditorClones.cloneEditor);
        
        addEditorListeners.call(this, EditorClones.cloneEditor);
        
        // add listeners to ceEditor properties that also need to be applied to
        // other editor instances:
        function setProp(which, value) {
            if (EditorClones[id] && EditorClones[id].length) {
                EditorClones[id].forEach(function(o) {
                    o.setAttribute(which, value);
                });
            }
            if (EditorClones.cloneEditor)
                EditorClones.cloneEditor.setAttribute(which, value);
        }
        editor.addEventListener("prop.wrapmode", function(e) {
            setProp("wrapmode", e.value);
        });
    }
    
    if (EditorClones[id] && EditorClones[id].length) {
        for (var clone, i = 0, l = EditorClones[id].length; i < l; ++i) {
            clone = EditorClones[id][i];
            clone.hide();
            apf.document.body.appendChild(clone);
        }
        return EditorClones[id];
    }

    addEditorListeners.call(this, editor);

    EditorClones[id] = [];
    EditorClones[id].original = editor;
    
    for (var i = 0; i < 2; ++i) {
        editor = editor.cloneNode(true);
        editor.removeAttribute("id");
        editor.setAttribute("visible", false);
        EditorClones[id].push(editor);
        apf.document.body.appendChild(editor);
        addEditorListeners.call(this, editor);
        if (isCodeEditor) {
            editor.$editor.commands = previousEditor.$editor.commands;
            if (previousEditor.$editor.getKeyboardHandler())
                editor.$editor.setKeyboardHandler(previousEditor.$editor.getKeyboardHandler());
        }
    }
    
    return EditorClones[id];
}


exports.getEditorSession = function(page) {
    var doc = page.$doc;
    if (!doc)
        return null;
    return doc.acesession || doc.session || null;
};

exports.consolidateEditorSession = function(page, editor) {
    var session = exports.getEditorSession(page);
    if (!session && page.$editor.setDocument) {
        var defEditor = page.$editor.amlEditor;
        var oldVal = defEditor.value;
        page.$editor.setDocument(page.$doc, page.$at);
        session = exports.getEditorSession(page);
        defEditor.setProperty("value", oldVal);
    }
    if (!editor)
        console.trace();
    editor.setAttribute("model", page.$model);
    editor.setAttribute("actiontracker", page.$at);
    if (editor.value !== session)
        editor.setProperty("value", session);
};

/**
 * Add listeners to the editor element, to keep track of the editor's focus.
 * Each time the focus changes, the tab title color will highlight.
 */
function addEditorListeners(editor) {
    if (editor.$splitListener)
        return;
    editor.addEventListener("focus", editor.$splitListener = function(e) {
        onEditorFocus(editor);
    });
}

function removeEditorListeners(editor) {
    if (!editor.$splitListener)
        return;
    //console.log("removing event listeners!!");
    editor.removeEventListener("focus", editor.$splitListener);
    delete editor.$splitListener;
}

var previousEditor;

function onEditorFocus(editor) {
    var splits = exports.get(editor);
    if (Editors.currentEditor && Editors.currentEditor.name.indexOf("Code Editor") > -1) {
        if (!previousEditor)
            previousEditor = Editors.currentEditor.amlEditor;
        Editors.currentEditor.amlEditor = editor;
        // invalidate search-replace's cache of the editor object
        delete SearchReplace.$editor;
    }

    splits.forEach(function(split) {
        var activePage = split.pairs[exports.indexOf(split, editor)].page;
        for (var page, i = 0, l = split.pairs.length; i < l; ++i) {
            page = split.pairs[i].page;
            if (page === activePage) {
                if (split.activePage !== i)
                    ide.dispatchEvent("pageswitch", { page: page });
                split.activePage = i;
                apf.setStyleClass(page.$button, ActiveClass, [InactiveClass]);
            }
            else
                apf.setStyleClass(page.$button, InactiveClass, [ActiveClass]);
        }
    });
}

function clearSplitViewStyles(splitOrPage) {
    var pages = (typeof splitOrPage.localName != "undefined") 
        ? [splitOrPage] 
        : splitOrPage.pairs.map(function(pair) { return pair.page; });
    pages.forEach(function(page) {
        apf.setStyleClass(page.$button, null, [ActiveClass, InactiveClass, NPlusOneClass]);
    });
}

function setSplitViewStyles(splitOrPage) {
    var pages = (typeof splitOrPage.localName != "undefined") 
        ? [null, splitOrPage] 
        : splitOrPage.pairs.map(function(pair) { return pair.page; });
    for (var i = 0, l = pages.length; i < l; ++i) {
        if (!pages[i])
            continue;
        if (i === 0)
            apf.setStyleClass(pages[i].$button, null, [NPlusOneClass]);
        else
            apf.setStyleClass(pages[i].$button, NPlusOneClass, []);
    }
}

var searchWindow, gotoLineWindow, searchPos;

function correctQuickSearchDialog(e) {
    var editor = Editors.currentEditor.amlEditor;
    var pos = !ActiveSplit ? -1 : exports.indexOf(ActiveSplit, editor);
    if (pos == -1)
        return;

    var parent = editor.parentNode;
    var editorPos = apf.getAbsolutePosition(editor.$ext, parent.$ext);
    var editorDims = {
        width: editor.$ext.offsetWidth,
        height: editor.$ext.offsetHeight
    };
    var parentDims = {
        width: parent.$ext.offsetWidth,
        height: parent.$ext.offsetHeight
    };

    if (!searchWindow && self["winQuickSearch"]) {
        searchWindow = self["winQuickSearch"];
        searchPos = apf.getStyle(searchWindow.$ext, "right");
        if (searchPos == "auto")
            searchPos = "30px";
    }
    if (searchWindow) {
        var right = parentDims.width - editorPos[0] - editorDims.width + 30;
        var top =  editorPos[1];
        //console.log("editorPos", editorPos,"editorDims",JSON.stringify(editorDims),"parentDims",JSON.stringify(parentDims),"right",right,"top",top);
        var to = Math.max(top, 0);
        return {
            right: Math.max(right, 30),
            zIndex: parseInt(editor.$ext.style.zIndex, 10) + 1,
            from: !e || e.anim == "out" ? to - 27 : 0,
            to: !e || e.anim == "out" ? to : (to - 30),
            onfinish: function() {
                searchWindow.$ext.style.zIndex = searchWindow.zindex;
            }
        };
    }
}

function correctGotoLineDialog(e) {
    var editor = Editors.currentEditor.amlEditor;
    var pos = !ActiveSplit ? -1 : exports.indexOf(ActiveSplit, editor);
    if (pos == -1)
        return;
        
    var parent = editor.parentNode;
    var editorPos = apf.getAbsolutePosition(editor.$ext, parent.$ext);
    var editorDims = {
        width: editor.$ext.offsetWidth,
        height: editor.$ext.offsetHeight
    };

    if (!gotoLineWindow && self["winGotoLine"])
        gotoLineWindow = self["winGotoLine"];

    if (gotoLineWindow) {
        var left = editorPos[0];
        var to = Math.max(left, 0);
        var maxTop = editorPos[1] + editorDims.height - 100;
        var top = e.pos ? Math.min(maxTop, e.pos.pageY - 70) : undefined;
        return {
            top: top,
            zIndex: parseInt(editor.$ext.style.zIndex, 10) + 1,
            from: e.anim == "out" ? to - 60 : 0,
            to: e.anim == "out" ? to + (to === 0 ? 2 : -1) : (to - 60)
        };
    }
}

function correctVimMode(e) {
    e.editors.push.apply(e.editors, EditorClones[e.editors[0].localName]);
    if (EditorClones.cloneEditor)
        e.editors.push(EditorClones.cloneEditor);
}

});
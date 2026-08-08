var canvas;
// keyCode -> pressed
var keyMap;
var srcObj;
var numPastes;
var destroyMemeEditor = function () {};

function deleteSelected(allowDeleteWhenEditing = false) {
    if (canvas) {
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length > 0) {
            activeObjects.forEach(obj => {
                if (allowDeleteWhenEditing || !obj.isEditing) {
                    canvas.remove(obj);
                }
            });
            canvas.discardActiveObject();
            canvas.renderAll();
        }
    }
}

function copySelected() {
    let obj = canvas.getActiveObject();
    if (obj && !obj.isEditing) {
        // clone it immediately so it is captured as it is, in case it is edited later
        srcObj = fabric.util.object.clone(obj);
        numPastes = 0;
        return true;
    }
    return false;
}

// Meme process
function processMeme(memeInfo) {
    const sizePlan = memeInfo.sizePlan || createImageSizePlan(memeInfo.width, memeInfo.height);
    if (sizePlan.error) {
        showAlert(`Error! ${sizePlan.error}`);
        return;
    }

    // Responsive canvas
    $(window).off('resize.memeEditor').on('resize.memeEditor', resizeCanvas);
    function resizeCanvas() {
        var width = $('.fabric-canvas-wrapper').width();
        $('.canvas-container').css('width', width);
        $('.canvas-container').css('height', width * sizePlan.workingHeight / sizePlan.workingWidth);
    }

    // brush tool state
    let brushMode = false;
    let brushSize = 10;
    let brushColor = '#000000ff';

    function colorStringToRgba(colorStr) {
        if (!colorStr) return 'rgba(0,0,0,1)';

        if (colorStr.startsWith('rgba')) {
            return colorStr;
        }

        if (colorStr.startsWith('#')) {
            let hex = colorStr;
            let r = 0, g = 0, b = 0, a = 1;

            if (hex.length === 4) { // #RGB
                r = parseInt(hex[1] + hex[1], 16);
                g = parseInt(hex[2] + hex[2], 16);
                b = parseInt(hex[3] + hex[3], 16);
            } else if (hex.length === 7) { // #RRGGBB
                r = parseInt(hex.slice(1, 3), 16);
                g = parseInt(hex.slice(3, 5), 16);
                b = parseInt(hex.slice(5, 7), 16);
            } else if (hex.length === 9) { // #RRGGBBAA
                r = parseInt(hex.slice(1, 3), 16);
                g = parseInt(hex.slice(3, 5), 16);
                b = parseInt(hex.slice(5, 7), 16);
                a = parseFloat((parseInt(hex.slice(7, 9), 16) / 255).toFixed(2));
            }
            return `rgba(${r},${g},${b},${a})`;
        }
        return colorStr;
    }

    // Intialize fabric canvas
    canvas = new fabric.Canvas('meme-canvas', {
        width: sizePlan.workingWidth,
        height: sizePlan.workingHeight,
        selection: false,
        allowTouchScrolling: true
    });

    const editorCanvas = canvas;
    const $generateButton = $('#generate-meme');
    let backgroundReady = false;
    let backgroundLoadFailed = false;
    let pendingAssetLoads = 0;
    let isExporting = false;
    const animationInfo = memeInfo.animationInfo;
    const $animationTimeline = $('#animation-timeline');
    const $animationSlider = $('#animation-frame-slider');
    const $animationSplit = $('#animation-split');
    const $animationQualityControls = $('#animation-quality-controls');
    const $animationQuality = $('#animation-quality');
    const $animationOutputFormat = $('#animation-output-format');
    const $animationGifWarning = $('#animation-gif-warning');
    let animationFrames;
    let animationFramePlayer;
    let activeAnimationDecoder;
    let activeAnimationEncoder;
    let animationExportLabel = '';
    let editorDestroyed = false;
    editorCanvas.animationTimeline = animationInfo ? animationInfo.timeline : undefined;
    const historyLimit = 50;
    const historyStates = [];
    const historyImageSources = {};
    let nextHistoryImageId = 1;
    let historyIndex = -1;
    let historyTimeout;
    let restoringHistory = false;
    let stateLoadToken = 0;
    var hoverAnimationRequestId;

    if (animationInfo && animationInfo.timeline.segments[0].editorState === null) {
        animationInfo.timeline.segments[0].editorState = [];
    }

    function updateGenerateButton() {
        const outputFormat = animationInfo
            ? ($animationOutputFormat.val() || animationInfo.format) : undefined;
        const outputFormatLabel = outputFormat
            ? ANIMATION_FORMATS[outputFormat].label : undefined;
        let label = animationInfo ? `Generate ${outputFormatLabel}` : 'Generate Meme';
        if (!backgroundReady) {
            label = backgroundLoadFailed ? 'Template Load Failed' : 'Loading Template...';
        }
        else if (pendingAssetLoads > 0) {
            label = 'Loading Image...';
        }
        else if (isExporting) {
            label = animationExportLabel ||
                (animationInfo ? `Generating ${outputFormatLabel}...` : 'Generating...');
        }
        $generateButton
            .prop('disabled', !backgroundReady || pendingAssetLoads > 0 || isExporting)
            .attr('aria-busy', !backgroundReady || pendingAssetLoads > 0 || isExporting)
            .text(label);
        $animationQuality.prop(
            'disabled', !animationInfo || !backgroundReady || pendingAssetLoads > 0 || isExporting
        );
        $animationOutputFormat.prop(
            'disabled', !animationInfo || !backgroundReady || pendingAssetLoads > 0 || isExporting
        );
    }

    $animationTimeline.attr('hidden', true);
    $animationQualityControls.attr('hidden', true);
    $animationGifWarning.attr('hidden', true);
    $animationQuality.val('full');
    if (animationInfo) {
        const outputFormats = [animationInfo.format].concat(
            Object.keys(ANIMATION_FORMATS).filter(format => format !== animationInfo.format)
        );
        $animationOutputFormat.empty();
        outputFormats.forEach(function (format, index) {
            const label = ANIMATION_FORMATS[format].label +
                (index === 0 ? ' (same as source)' : '');
            $('<option></option>').val(format).text(label).appendTo($animationOutputFormat);
        });
        $animationOutputFormat.val(animationInfo.format);
        $animationQualityControls.removeAttr('hidden');
    }

    function updateAnimationOutputOptions() {
        const outputFormat = $animationOutputFormat.val();
        $animationQuality.val(outputFormat === 'webp' ? 'balanced' : 'full');
        $animationGifWarning.attr(
            'hidden', !animationInfo || animationInfo.format === 'gif' || outputFormat !== 'gif'
        );
        updateGenerateButton();
    }

    $animationOutputFormat.off('change').on('change', updateAnimationOutputOptions);
    updateAnimationOutputOptions();

    function updateHistoryButtons() {
        $('#canvas-undo').prop('disabled', restoringHistory || historyIndex <= 0);
        $('#canvas-redo').prop(
            'disabled', restoringHistory || historyIndex >= historyStates.length - 1
        );
        if (animationInfo && animationFrames) {
            $animationSlider.prop('disabled', restoringHistory || isExporting);
            if (restoringHistory) {
                $animationSplit.prop('disabled', true);
            }
        }
    }

    function serializeEditorObjects() {
        return editorCanvas.getObjects().map(function (object) {
            const serialized = object.toObject();
            if (object.type === 'image') {
                if (!object.__historyImageId) {
                    object.__historyImageId = nextHistoryImageId++;
                }
                if (!historyImageSources[object.__historyImageId]) {
                    historyImageSources[object.__historyImageId] = serialized.src;
                }
                serialized.__historyImageId = object.__historyImageId;
                delete serialized.src;
            }
            return serialized;
        });
    }

    function cloneEditorState(editorState) {
        return JSON.parse(JSON.stringify(editorState || []));
    }

    function findAnimationSegmentIndex(frameIndex) {
        const segments = animationInfo.timeline.segments;
        for (let index = segments.length - 1; index >= 0; index--) {
            if (segments[index].startFrame <= frameIndex) {
                return index;
            }
        }
        return 0;
    }

    function captureActiveSegmentState(objects) {
        if (!animationInfo) {
            return;
        }
        const timeline = animationInfo.timeline;
        timeline.segments[timeline.activeSegmentIndex].editorState = cloneEditorState(
            objects || serializeEditorObjects()
        );
    }

    function serializeHistoryState() {
        const objects = serializeEditorObjects();
        if (animationInfo) {
            captureActiveSegmentState(objects);
            return JSON.stringify({
                segments: animationInfo.timeline.segments.map(function (segment) {
                    return {
                        startFrame: segment.startFrame,
                        editorState: cloneEditorState(segment.editorState),
                    };
                }),
            });
        }
        return JSON.stringify({ objects: objects });
    }

    function recordHistoryState() {
        if (restoringHistory || canvas !== editorCanvas) {
            return;
        }
        const state = serializeHistoryState();
        if (historyIndex >= 0 && historyStates[historyIndex] === state) {
            updateHistoryButtons();
            return;
        }
        historyStates.splice(historyIndex + 1);
        historyStates.push(state);
        if (historyStates.length > historyLimit) {
            historyStates.shift();
        }
        historyIndex = historyStates.length - 1;
        updateHistoryButtons();
    }

    function flushScheduledHistory() {
        if (historyTimeout !== undefined) {
            clearTimeout(historyTimeout);
            historyTimeout = undefined;
            recordHistoryState();
        }
    }

    scheduleCanvasHistory = function () {
        if (restoringHistory || canvas !== editorCanvas) {
            return;
        }
        if (historyTimeout !== undefined) {
            clearTimeout(historyTimeout);
        }
        historyTimeout = setTimeout(function () {
            historyTimeout = undefined;
            recordHistoryState();
        }, 200);
    };

    function restoreHistoryState(index) {
        if (restoringHistory || index < 0 || index >= historyStates.length) {
            return;
        }
        restoringHistory = true;
        historyIndex = index;
        updateHistoryButtons();

        const historyState = JSON.parse(historyStates[historyIndex]);
        let serializedObjects;
        if (animationInfo) {
            animationInfo.timeline.segments = historyState.segments.map(function (segment) {
                return {
                    startFrame: segment.startFrame,
                    editorState: cloneEditorState(segment.editorState),
                };
            });
            animationInfo.timeline.activeSegmentIndex = findAnimationSegmentIndex(
                animationInfo.timeline.currentFrame
            );
            serializedObjects = cloneEditorState(
                animationInfo.timeline.segments[
                    animationInfo.timeline.activeSegmentIndex
                ].editorState
            );
        }
        else {
            serializedObjects = historyState.objects;
        }
        loadEditorState(serializedObjects, function () {
            if (animationInfo) {
                if (animationFramePlayer) {
                    animationFramePlayer.showFrame(animationInfo.timeline.currentFrame);
                }
                updateAnimationTimeline();
            }
        });
    }

    function hydrateEditorState(serializedObjects) {
        const hydrated = cloneEditorState(serializedObjects);
        hydrated.forEach(function (object) {
            if (object.type === 'image') {
                object.src = historyImageSources[object.__historyImageId];
            }
        });
        return hydrated;
    }

    function loadEditorState(serializedObjects, onComplete) {
        const loadToken = ++stateLoadToken;
        restoringHistory = true;
        updateHistoryButtons();
        const hydratedObjects = hydrateEditorState(serializedObjects || []);
        fabric.util.enlivenObjects(hydratedObjects, function (objects) {
            if (canvas !== editorCanvas || loadToken !== stateLoadToken) {
                return;
            }
            editorCanvas.discardActiveObject();
            editorCanvas.getObjects().slice().forEach(function (object) {
                editorCanvas.remove(object);
            });
            objects.forEach(function (object, objectIndex) {
                object.__historyImageId = hydratedObjects[objectIndex].__historyImageId;
                editorCanvas.add(object);
            });
            editorCanvas.renderAll();
            restoringHistory = false;
            updateHistoryButtons();
            if (onComplete) {
                onComplete();
            }
        });
    }

    function undoCanvas() {
        if (restoringHistory) {
            return;
        }
        flushScheduledHistory();
        restoreHistoryState(historyIndex - 1);
    }

    function redoCanvas() {
        if (restoringHistory) {
            return;
        }
        flushScheduledHistory();
        restoreHistoryState(historyIndex + 1);
    }

    function getAnimationFrameStartTime(frameIndex) {
        let timestamp = 0;
        for (let index = 0; animationFrames && index < frameIndex; index++) {
            timestamp += animationFrames[index].delay;
        }
        return timestamp;
    }

    function updateAnimationTimeline() {
        if (!animationInfo || !animationFrames) {
            $animationTimeline.attr('hidden', true);
            return;
        }
        const timeline = animationInfo.timeline;
        const frameIndex = timeline.currentFrame;
        const segmentIndex = findAnimationSegmentIndex(frameIndex);
        timeline.activeSegmentIndex = segmentIndex;
        const segment = timeline.segments[segmentIndex];
        const nextSegment = timeline.segments[segmentIndex + 1];
        const endFrame = nextSegment ? nextSegment.startFrame - 1 : animationFrames.length - 1;
        const alreadySplit = timeline.segments.some(function (candidate) {
            return candidate.startFrame === frameIndex;
        });

        $animationTimeline.removeAttr('hidden');
        $animationSlider
            .attr('max', animationFrames.length - 1)
            .val(frameIndex)
            .prop('disabled', restoringHistory || isExporting);
        $('#animation-frame-label').text(
            `Frame ${frameIndex + 1} of ${animationFrames.length} · ` +
            `${(getAnimationFrameStartTime(frameIndex) / 1000).toFixed(1)}s`
        );
        $('#animation-range-label').text(
            segment.startFrame === endFrame
                ? `Editing frame ${segment.startFrame + 1}`
                : `Editing frames ${segment.startFrame + 1}–${endFrame + 1}`
        );
        $animationSplit.prop('disabled', alreadySplit || restoringHistory || isExporting);

        const markerContainer = $('#animation-segment-markers').empty();
        timeline.segments.forEach(function (candidate) {
            const percent = animationFrames.length <= 1 ? 0 :
                candidate.startFrame * 100 / (animationFrames.length - 1);
            $('<span class="animation-segment-marker"></span>')
                .toggleClass('active', candidate.startFrame === segment.startFrame)
                .css('left', `${percent}%`)
                .appendTo(markerContainer);
        });
    }

    function seekAnimationFrame(frameIndex) {
        if (!animationInfo || !animationFrames || restoringHistory || isExporting) {
            updateAnimationTimeline();
            return;
        }
        const timeline = animationInfo.timeline;
        const oldSegmentIndex = timeline.activeSegmentIndex;
        flushScheduledHistory();
        captureActiveSegmentState();
        timeline.currentFrame = Math.max(
            0, Math.min(animationFrames.length - 1, Number(frameIndex))
        );
        const newSegmentIndex = findAnimationSegmentIndex(timeline.currentFrame);
        timeline.activeSegmentIndex = newSegmentIndex;
        animationFramePlayer.showFrame(timeline.currentFrame);
        if (newSegmentIndex !== oldSegmentIndex) {
            loadEditorState(
                timeline.segments[newSegmentIndex].editorState,
                updateAnimationTimeline
            );
        }
        else {
            updateAnimationTimeline();
        }
    }

    function splitAnimationTimeline() {
        if (!animationInfo || !animationFrames || restoringHistory || isExporting) {
            return;
        }
        const timeline = animationInfo.timeline;
        const frameIndex = timeline.currentFrame;
        if (timeline.segments.some(segment => segment.startFrame === frameIndex)) {
            return;
        }
        flushScheduledHistory();
        captureActiveSegmentState();
        const sourceIndex = findAnimationSegmentIndex(frameIndex);
        timeline.segments.splice(sourceIndex + 1, 0, {
            startFrame: frameIndex,
            editorState: cloneEditorState(timeline.segments[sourceIndex].editorState),
        });
        timeline.activeSegmentIndex = sourceIndex + 1;
        recordHistoryState();
        updateAnimationTimeline();
    }

    $animationSlider.off('input').on('input', function () {
        seekAnimationFrame(parseInt(this.value, 10));
    });
    $animationSplit.off('click').on('click', splitAnimationTimeline);

    editorCanvas.on({
        'object:added': scheduleCanvasHistory,
        'object:removed': scheduleCanvasHistory,
        'object:modified': scheduleCanvasHistory,
    });
    recordHistoryState();

    destroyMemeEditor = function () {
        editorDestroyed = true;
        $(window).off('.memeEditor');
        if (historyTimeout !== undefined) {
            clearTimeout(historyTimeout);
        }
        scheduleCanvasHistory = function () {};
        if (hoverAnimationRequestId !== undefined) {
            cancelAnimationFrame(hoverAnimationRequestId);
        }
        if (animationFramePlayer) {
            animationFramePlayer.destroy();
        }
        if (activeAnimationDecoder) {
            activeAnimationDecoder.terminate();
            activeAnimationDecoder = undefined;
        }
        if (activeAnimationEncoder) {
            activeAnimationEncoder.terminate();
            activeAnimationEncoder = undefined;
        }
        animationFrames = undefined;
        $animationSlider.off('input');
        $animationSplit.off('click');
        $animationOutputFormat.off('change').empty();
        $animationQualityControls.attr('hidden', true);
        $animationGifWarning.attr('hidden', true);
        $animationQuality.val('full');
        $('#animation-segment-markers').empty();
        $animationTimeline.attr('hidden', true);
        editorCanvas.dispose();
        $('#meme-canvas').remove();
        if (canvas === editorCanvas) {
            canvas = undefined;
        }
        keyMap = undefined;
        srcObj = undefined;
        numPastes = undefined;
        destroyMemeEditor = function () {};
    };

    keyMap = new Map();
    srcObj = null;
    numPastes = 0;

    // Ensure select mode is the default
    canvas.selection = true;
    canvas.defaultCursor = 'default';

    // Brush tool using Fabric.js free drawing mode
    function setBrushMode(active) {
        if (active) {
            disableTextMethods();
            canvas.isDrawingMode = true;
            if (!canvas.freeDrawingBrush) {
                canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
                const originalRender = canvas.freeDrawingBrush._render;
                canvas.freeDrawingBrush._render = function() {
                    originalRender.call(this);
                    if (this._points && this._points.length > 0) {
                        const pointer = this._points[this._points.length - 1];
                        const radius = this.width / 2;
                        const ctx = this.canvas.contextTop;
                        ctx.beginPath();
                        ctx.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2, false);
                        ctx.fillStyle = colorStringToRgba(this.color);
                        ctx.fill();
                    }
                };
            }
            canvas.freeDrawingBrush.width = brushSize;
            canvas.freeDrawingBrush.color = brushColor;
            canvas.freeDrawingBrush.strokeLineJoin = 'round';
            canvas.freeDrawingBrush.strokeLineCap = 'round';
            canvas.selection = false;
            canvas.freeDrawingCursor = 'none';
        }
        else {
            enableTextMethods();
            canvas.isDrawingMode = false;
            canvas.selection = true;
            canvas.defaultCursor = 'default';
            canvas.clearContext(canvas.contextTop);
        }
    }

    // Ensure brush controls are hidden and brush mode is off by default
    $('#brush-controls').hide();
    $('#toggle-brush').removeClass('active');
    brushMode = false;
    setBrushMode(false);

    function toggleBrush(obj, newBrushMode) {
        brushMode = newBrushMode;
        canvas.discardActiveObject().renderAll();
        if (brushMode) {
            obj.addClass('active');
            $('#brush-controls').show();
        }
        else {
            obj.removeClass('active');
            $('#brush-controls').hide();
        }
        setBrushMode(brushMode);
    }

    // Brush tool UI events (after canvas is created)
    $('#toggle-brush').off('click').on('click', function() {
        toggleBrush($(this), !brushMode);
    });

    function setBrushSize(obj) {
        brushSize = parseInt(obj.val());
        $('#brush-size-display').text(brushSize + 'px');
        if (brushMode && canvas.freeDrawingBrush) {
            canvas.freeDrawingBrush.width = brushSize;
        }
    }

    setBrushSize($('#brush-size'));

    $('#brush-size').off('input').on('input', function() {
        setBrushSize($(this));
    });

    function setBrushColor(obj) {
        brushColor = obj.colorpicker('getValue');
        if (brushMode && canvas.freeDrawingBrush) {
            canvas.freeDrawingBrush.color = brushColor;
        }
    }

    setBrushColor($('#cp-brush'));

    $('#cp-brush').off('colorpickerChange').on('colorpickerChange', function() {
        setBrushColor($(this));
    });

    // we select the wrapper because it'll be present on document load
    // divs also need a tab index to be focusable
    $('#meme-canvas-wrapper').off('keydown').keydown(function (e) {
        keyMap[e.keyCode] = true;
        const activeObjectForShortcut = canvas.getActiveObject();
        const modifierKey = e.ctrlKey || e.metaKey;
        const shortcutKey = (e.key || '').toLowerCase();
        if (modifierKey && !(activeObjectForShortcut && activeObjectForShortcut.isEditing)) {
            if (shortcutKey === 'z') {
                if (e.shiftKey) {
                    redoCanvas();
                }
                else {
                    undoCanvas();
                }
                e.preventDefault();
                return;
            }
            if (shortcutKey === 'y') {
                redoCanvas();
                e.preventDefault();
                return;
            }
        }
        // ctrl is being held down
        if (keyMap[17] === true) {
            // ctrl + c
            if (keyMap[67] === true) {
                if (copySelected()) {
                    e.preventDefault();
                }
            }
            // ctrl + x
            if (keyMap[88] === true) {
                if (copySelected()) {
                    deleteSelected();
                    e.preventDefault();
                }
            }
            // ctrl + v
            if (keyMap[86] === true) {
                if (srcObj) {
                    srcObj.clone(function(newObj) {
                        // place it a little bit down and to the right
                        newObj.set("top", srcObj.top + (10 * (1 + numPastes)));
                        newObj.set("left", srcObj.left + (10 * (1 + numPastes)));
                        canvas.add(newObj);
                        // keep moving down and to the right with each new paste
                        numPastes++;
                    });
                    e.preventDefault();
                }
            }
        }
        // delete selected element
        if (e.keyCode == 46 ||
            e.key == 'Delete' ||
            e.code == 'Delete') {
            deleteSelected();
        }

        // handle arrow keys
        // this gets the group if a group is selected
        const activeObject = canvas.getActiveObject();
        if (activeObject) {
            const moveMultiplier = 5;
            let moveX = 0;
            let moveY = 0;

            switch (e.key) {
                case 'ArrowUp':
                    moveY = -moveMultiplier;
                    break;
                case 'ArrowDown':
                    moveY = moveMultiplier;
                    break;
                case 'ArrowLeft':
                    moveX = -moveMultiplier;
                    break;
                case 'ArrowRight':
                    moveX = moveMultiplier;
                    break;
            }

            if (moveX !== 0 || moveY !== 0) {
                activeObject.left += moveX;
                activeObject.top += moveY;
                activeObject.setCoords();
                canvas.renderAll();
                scheduleCanvasHistory();
                e.preventDefault();
            }
        }
    });

    $('#meme-canvas-wrapper').off('keyup').keyup(function (e) {
        keyMap[e.keyCode] = false;
    });

    // Scale is a range input allow small screen users to scale the object easily
    $('#scale').attr('max', canvas.width * 0.0025);
    $('#scale').val(canvas.width * 0.0025 / 2);

    resizeCanvas();

    function reportBackgroundLoadFailure(message) {
        backgroundLoadFailed = true;
        showAlert(message);
        updateGenerateButton();
    }

    function loadStaticBackground() {
        fabric.Image.fromURL(`${memeInfo.url}`, function (meme, isError) {
            if (canvas !== editorCanvas) {
                return;
            }
            if (isError) {
                reportBackgroundLoadFailure('Error! The meme template could not be loaded.');
                return;
            }
            try {
                if (sizePlan.outputWasReduced) {
                    const resizedTemplate = document.createElement('canvas');
                    resizedTemplate.width = sizePlan.outputWidth;
                    resizedTemplate.height = sizePlan.outputHeight;
                    resizedTemplate.getContext('2d').drawImage(
                        meme.getElement(), 0, 0, sizePlan.outputWidth, sizePlan.outputHeight
                    );
                    meme.setElement(resizedTemplate);
                }
                meme.set({
                    scaleX: sizePlan.workingWidth / meme.width,
                    scaleY: sizePlan.workingHeight / meme.height,
                });
            }
            catch (error) {
                reportBackgroundLoadFailure('Error! The meme template was too large to prepare.');
                return;
            }
            editorCanvas.setBackgroundImage(meme, function () {
                backgroundReady = true;
                editorCanvas.renderAll();
                updateGenerateButton();
                if (sizePlan.outputWasReduced) {
                    showAlert(
                        `Large image: output will be resized from ${sizePlan.sourceWidth} x ${sizePlan.sourceHeight} ` +
                        `to ${sizePlan.outputWidth} x ${sizePlan.outputHeight}.`
                    );
                }
            });
        }, {
            crossOrigin: "anonymous"
        });
    }

    async function loadAnimatedBackground() {
        try {
            activeAnimationDecoder = createAnimationFrameDecoder(animationInfo);
            const frames = await activeAnimationDecoder.promise;
            activeAnimationDecoder = undefined;
            if (editorDestroyed || canvas !== editorCanvas) {
                return;
            }
            animationFrames = frames;
            animationInfo.buffer = undefined;
            const frameCanvas = document.createElement('canvas');
            frameCanvas.width = animationInfo.metadata.width;
            frameCanvas.height = animationInfo.metadata.height;
            const frameContext = frameCanvas.getContext('2d');
            const meme = new fabric.Image(frameCanvas, {
                scaleX: sizePlan.workingWidth / frameCanvas.width,
                scaleY: sizePlan.workingHeight / frameCanvas.height,
                objectCaching: false,
            });

            function displayFrame(frame, frameIndex) {
                frameContext.putImageData(
                    new ImageData(frame.data, frame.width, frame.height), 0, 0
                );
                meme.dirty = true;
                animationInfo.timeline.currentFrame = frameIndex;
                editorCanvas.requestRenderAll();
            }

            animationFramePlayer = createAnimationFramePlayer(frames, displayFrame);
            editorCanvas.setBackgroundImage(meme, function () {
                if (editorDestroyed || canvas !== editorCanvas) {
                    return;
                }
                backgroundReady = true;
                editorCanvas.renderAll();
                updateGenerateButton();
                updateAnimationTimeline();
                if (sizePlan.outputWasReduced) {
                    showAlert(
                        `Large ${animationInfo.formatLabel}: output will be resized from ` +
                        `${sizePlan.sourceWidth} x ` +
                        `${sizePlan.sourceHeight} to ${sizePlan.outputWidth} x ${sizePlan.outputHeight}.`
                    );
                }
            });
        }
        catch (error) {
            if (!editorDestroyed && canvas === editorCanvas) {
                reportBackgroundLoadFailure(`Error! ${error.message}`);
            }
        }
    }

    if (animationInfo) {
        loadAnimatedBackground();
    }
    else {
        loadStaticBackground();
    }

    // Event: Add new text
    $('#add-text').off('click').on('click', function () {
        let textContent = 'text';

        // Create new text object
        var text = new fabric.Textbox(textContent, {
            top: 10,
            left: 10,
            fontFamily: $('#font-family').find(":selected").attr('value'),
            textAlign: $('input[name="align"]:checked').val(),
            fill: $('#cp-text').colorpicker('getValue'),
            fontStyle: $('#italic').attr('data'),
            fontWeight: $('#bold').attr('data'),
            underline: $('#underline').attr('data'),
            stroke: $('#cp-stroke').colorpicker('getValue'),
            strokeWidth: $('#stroke-width').val(),
            shadow: createShadow($('#cp-shadow').colorpicker('getValue'), $('#shadow-depth').val()),
            textBackgroundColor: getBackgroundColor($('#cp-background').colorpicker('getValue')),
            opacity: parseFloat($('#opacity').val()) / 100
        });

        text.scaleToWidth(canvas.width / 5);
        $('#scale').val(text.scaleX);

        canvas.add(text).setActiveObject(text);
        loadFont(text.fontFamily);
        toggleBrush($('#toggle-brush'), false);
    });

    // Event: Add new image
    $('#add-image').off('input').on('input', function () {
        const file = this.files[0];
        $('#add-image').val('');

        if (!file) {
            return;
        }

        if (!isImage(file.type)) {
            showAlert('Error! Invalid Image');
            return;
        }

        pendingAssetLoads++;
        updateGenerateButton();

        function finishImageLoad() {
            pendingAssetLoads--;
            updateGenerateButton();
        }

        const reader = new FileReader();
        reader.onload = function () {
            fabric.Image.fromURL(reader.result, function (image, isError) {
                if (canvas !== editorCanvas) {
                    return;
                }
                if (isError) {
                    showAlert('Error! The selected image could not be decoded.');
                    finishImageLoad();
                    return;
                }
                const imageSizePlan = createImageSizePlan(image.width, image.height);
                if (imageSizePlan.error) {
                    showAlert(`Error! ${imageSizePlan.error}`);
                    finishImageLoad();
                    return;
                }
                if (imageSizePlan.outputWasReduced) {
                    try {
                        const resizedImage = document.createElement('canvas');
                        resizedImage.width = imageSizePlan.outputWidth;
                        resizedImage.height = imageSizePlan.outputHeight;
                        resizedImage.getContext('2d').drawImage(
                            image.getElement(), 0, 0,
                            imageSizePlan.outputWidth, imageSizePlan.outputHeight
                        );
                        image.setElement(resizedImage);
                        showAlert(
                            `Large added image resized to ${imageSizePlan.outputWidth} x ` +
                            `${imageSizePlan.outputHeight}.`
                        );
                    }
                    catch (error) {
                        showAlert('Error! The selected image was too large to prepare.');
                        finishImageLoad();
                        return;
                    }
                }
                image.scaleToWidth(editorCanvas.width / 2);
                editorCanvas.add(image).setActiveObject(image);
                $('#scale').val(image.scaleX);
                finishImageLoad();
            }, {
                opacity: parseFloat($('#opacity').val()) / 100
            });
        }
        reader.onerror = function () {
            showAlert('Error! The selected image could not be read.');
            finishImageLoad();
        }
        reader.onabort = function () {
            showAlert('Image loading was cancelled.');
            finishImageLoad();
        }
        reader.readAsDataURL(file);

        toggleBrush($('#toggle-brush'), false);
    });

    $("#canvas-delete").off('click').on('click', function () {
        deleteSelected(true);
    });

    $('#canvas-undo').off('click').on('click', undoCanvas);
    $('#canvas-redo').off('click').on('click', redoCanvas);

    $("#canvas-clear").off('click').on('click', function () {
        canvas.getObjects().forEach(el => canvas.remove(el));
        canvas.discardActiveObject().renderAll();
    });

    // Custom control
    fabric.Object.prototype.set({
        transparentCorners: false,
        cornerColor: 'yellow',
        borderColor: 'rgba(88,42,114)',
        cornerSize: parseInt(canvas.width) * 0.03,
        cornerStrokeColor: '#000000',
        borderScaleFactor: 2,
        padding: 4,
    });

    // add event listener handlers to edit methods
    loadObjectHandlers();

    // Update edit methods values to the selected canvas text
    canvas.on({
        'selection:created': updateInputs,
        'selection:updated': updateInputs,
        'selection:cleared': enableTextMethods,
    });

    function updateBrushCursor(o, ts) {
        hoverAnimationRequestId = undefined;
        if (!brushMode) return;
        var pointer = canvas.getPointer(o.e);
        var radius = brushSize / 2;
        var ctx = canvas.contextTop;
        canvas.clearContext(ctx);
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2, false);
        ctx.fillStyle = colorStringToRgba(brushColor);
        ctx.fill();
    }

    function mouseMoveCursorHandler(o) {
        if (!brushMode) return;
        if (hoverAnimationRequestId === undefined) {
            hoverAnimationRequestId = requestAnimationFrame(updateBrushCursor.bind(null, o));
        }
    }

    canvas.on('mouse:move', mouseMoveCursorHandler);

    let isMouseDown = false;

    canvas.on('mouse:down', function(o) {
        if (!brushMode) return;
        isMouseDown = true;
        canvas.off('mouse:move', mouseMoveCursorHandler);
    });

    canvas.on('mouse:up', function(o) {
        if (!brushMode) return;
        isMouseDown = false;
        canvas.on('mouse:move', mouseMoveCursorHandler);
    });

    canvas.on('mouse:out', function () {
        if (!brushMode) return;
        if (!isMouseDown) {
            canvas.clearContext(canvas.contextTop);
        }
    });

    function downloadGeneratedBlob(blob, extension) {
        // An attachment MIME type prevents browsers from previewing animated
        // image object URLs instead of honoring the download request.
        const attachmentBlob = new Blob([blob], { type: 'application/octet-stream' });
        const objectUrl = URL.createObjectURL(attachmentBlob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = createImgName().replace(/\.png$/, extension);
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () {
            URL.revokeObjectURL(objectUrl);
        }, 1000);
    }

    function renderSerializedOverlay(editorState) {
        return new Promise(function (resolve, reject) {
            const overlayEditor = new fabric.StaticCanvas(null, {
                width: sizePlan.workingWidth,
                height: sizePlan.workingHeight,
                renderOnAddRemove: false,
            });
            try {
                overlayEditor.loadFromJSON({ objects: hydrateEditorState(editorState) }, function () {
                    try {
                        overlayEditor.renderAll();
                        const overlay = overlayEditor.toCanvasElement(sizePlan.exportMultiplier);
                        overlayEditor.dispose();
                        resolve(overlay);
                    }
                    catch (error) {
                        overlayEditor.dispose();
                        reject(error);
                    }
                });
            }
            catch (error) {
                overlayEditor.dispose();
                reject(error);
            }
        });
    }

    async function renderAnimationSegmentOverlays() {
        captureActiveSegmentState();
        const overlays = [];
        for (const segment of animationInfo.timeline.segments) {
            overlays.push(await renderSerializedOverlay(segment.editorState));
        }
        return overlays;
    }

    async function exportAnimatedImage() {
        animationFramePlayer.pause();
        flushScheduledHistory();
        const outputFormat = $animationOutputFormat.val() || animationInfo.format;
        const outputInfo = ANIMATION_FORMATS[outputFormat];
        const qualityProfile = resolveAnimationQualityProfile(
            outputFormat, $animationQuality.val(), sizePlan
        );
        const segmentOverlays = await renderAnimationSegmentOverlays();
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = animationInfo.metadata.width;
        sourceCanvas.height = animationInfo.metadata.height;
        const sourceContext = sourceCanvas.getContext('2d');
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = qualityProfile.outputWidth;
        outputCanvas.height = qualityProfile.outputHeight;
        const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
        outputContext.imageSmoothingEnabled = true;
        outputContext.imageSmoothingQuality = 'high';

        activeAnimationEncoder = createAnimationEncoder(
            animationInfo, outputFormat, qualityProfile.outputWidth,
            qualityProfile.outputHeight, qualityProfile
        );
        await activeAnimationEncoder.initialize();

        let segmentIndex = 0;
        for (let frameIndex = 0; frameIndex < animationFrames.length; frameIndex++) {
            if (editorDestroyed || canvas !== editorCanvas) {
                throw new Error(`The ${outputInfo.label} operation was cancelled.`);
            }
            const frame = animationFrames[frameIndex];
            sourceContext.putImageData(
                new ImageData(frame.data, frame.width, frame.height), 0, 0
            );
            outputContext.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
            outputContext.drawImage(
                sourceCanvas, 0, 0, outputCanvas.width, outputCanvas.height
            );
            while (segmentIndex + 1 < animationInfo.timeline.segments.length &&
                animationInfo.timeline.segments[segmentIndex + 1].startFrame <= frameIndex) {
                segmentIndex++;
            }
            outputContext.drawImage(
                segmentOverlays[segmentIndex], 0, 0,
                outputCanvas.width, outputCanvas.height
            );
            const pixels = outputContext.getImageData(
                0, 0, outputCanvas.width, outputCanvas.height
            ).data;
            animationExportLabel = `Preparing ${outputInfo.label}... ` +
                `${frameIndex + 1}/${animationFrames.length}`;
            updateGenerateButton();
            await activeAnimationEncoder.addFrame(pixels, frame.delay);
        }

        animationExportLabel = `Encoding ${outputInfo.label}...`;
        updateGenerateButton();
        const blob = await activeAnimationEncoder.finish();
        if (!editorDestroyed && canvas === editorCanvas) {
            downloadGeneratedBlob(blob, outputInfo.extension);
        }
    }

    $('#generate-meme').off('click').on('click', function () {
        if (!backgroundReady || pendingAssetLoads > 0 || isExporting) {
            return;
        }

        isExporting = true;
        updateGenerateButton();
        if (animationInfo) {
            updateAnimationTimeline();
        }

        if (animationInfo) {
            exportAnimatedImage().catch(function (error) {
                if (!editorDestroyed && canvas === editorCanvas) {
                    showAlert(
                        `Error! ${error.message || 'The animation could not be generated.'}`
                    );
                }
            }).finally(function () {
                if (activeAnimationEncoder) {
                    activeAnimationEncoder.terminate();
                    activeAnimationEncoder = undefined;
                }
                animationExportLabel = '';
                isExporting = false;
                if (!editorDestroyed && canvas === editorCanvas) {
                    animationFramePlayer.showFrame(animationInfo.timeline.currentFrame);
                    updateAnimationTimeline();
                    updateGenerateButton();
                }
            });
            return;
        }

        try {
            const exportCanvas = editorCanvas.toCanvasElement(sizePlan.exportMultiplier);
            exportCanvas.toBlob(function (blob) {
                if (!blob) {
                    showAlert('Error! The meme could not be generated.');
                }
                else {
                    downloadGeneratedBlob(blob, '.png');
                }

                isExporting = false;
                if (canvas === editorCanvas) {
                    updateGenerateButton();
                }
            }, 'image/png');
        }
        catch (error) {
            isExporting = false;
            updateGenerateButton();
            showAlert('Error! The meme could not be generated.');
        }
    });
}

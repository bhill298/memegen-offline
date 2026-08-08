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
    var hoverAnimationRequestId;

    function updateGenerateButton() {
        let label = 'Generate Meme';
        if (!backgroundReady) {
            label = backgroundLoadFailed ? 'Template Load Failed' : 'Loading Template...';
        }
        else if (pendingAssetLoads > 0) {
            label = 'Loading Image...';
        }
        else if (isExporting) {
            label = 'Generating...';
        }
        $generateButton
            .prop('disabled', !backgroundReady || pendingAssetLoads > 0 || isExporting)
            .attr('aria-busy', !backgroundReady || pendingAssetLoads > 0 || isExporting)
            .text(label);
    }

    updateGenerateButton();

    destroyMemeEditor = function () {
        $(window).off('.memeEditor');
        if (hoverAnimationRequestId !== undefined) {
            cancelAnimationFrame(hoverAnimationRequestId);
        }
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

    // Add meme template as canvas background
    fabric.Image.fromURL(`${memeInfo.url}`, function (meme, isError) {
        if (canvas !== editorCanvas) {
            return;
        }
        if (isError) {
            backgroundLoadFailed = true;
            showAlert('Error! The meme template could not be loaded.');
            updateGenerateButton();
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
            backgroundLoadFailed = true;
            showAlert('Error! The meme template was too large to prepare.');
            updateGenerateButton();
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

    $('#generate-meme').off('click').on('click', function () {
        if (!backgroundReady || pendingAssetLoads > 0 || isExporting) {
            return;
        }

        isExporting = true;
        updateGenerateButton();

        try {
            const exportCanvas = editorCanvas.toCanvasElement(sizePlan.exportMultiplier);
            exportCanvas.toBlob(function (blob) {
                if (!blob) {
                    showAlert('Error! The meme could not be generated.');
                }
                else {
                    const objectUrl = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = objectUrl;
                    link.download = createImgName();
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    setTimeout(function () {
                        URL.revokeObjectURL(objectUrl);
                    }, 1000);
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

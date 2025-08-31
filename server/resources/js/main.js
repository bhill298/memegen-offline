var canvas;
// keyCode -> pressed
var keyMap;
var srcObj;
var numPastes;

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
    // Responsive canvas
    $(window).resize(resizeCanvas);
    function resizeCanvas() {
        var width = $('.fabric-canvas-wrapper').width();
        $('.canvas-container').css('width', width);
        $('.canvas-container').css('height', width * memeInfo.height / memeInfo.width);
    }

    // brush tool state
    let brushMode = false;
    let brushSize = 10;
    let brushColor = '#000000ff';

    // Intialize fabric canvas
    canvas = new fabric.Canvas('meme-canvas', {
        width: memeInfo.width,
        height: memeInfo.height,
        selection: false,
        allowTouchScrolling: true
    });

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
            }
            canvas.freeDrawingBrush.width = brushSize;
            canvas.freeDrawingBrush.color = brushColor;
            canvas.selection = false;
            canvas.defaultCursor = 'crosshair';
        }
        else {
            enableTextMethods();
            canvas.isDrawingMode = false;
            canvas.selection = true;
            canvas.defaultCursor = 'default';
        }
    }

    // Ensure brush controls are hidden and brush mode is off by default
    $('#brush-controls').hide();
    $('#toggle-brush').removeClass('active');
    brushMode = false;
    setBrushMode(false);

    // Brush tool UI events (after canvas is created)
    $('#toggle-brush').off('click').on('click', function() {
        brushMode = !brushMode;
        canvas.discardActiveObject().renderAll();
        if (brushMode) {
            $(this).addClass('active');
            $('#brush-controls').show();
        } else {
            $(this).removeClass('active');
            $('#brush-controls').hide();
        }
        setBrushMode(brushMode);
    });

    function setBrushSize() {
        brushSize = parseInt($("#brush-size").val());
        $('#brush-size-display').text(brushSize + 'px');
        if (brushMode && canvas.freeDrawingBrush) {
            canvas.freeDrawingBrush.width = brushSize;
        }
    }

    setBrushSize();

    $('#brush-size').off('input').on('input', function() {
        setBrushSize();
    });

    function setBrushColor() {
        brushColor = $('#cp-brush').colorpicker('getValue');
        if (brushMode && canvas.freeDrawingBrush) {
            canvas.freeDrawingBrush.color = brushColor;
        }
    }

    setBrushColor();

    $('#cp-brush').off('colorpickerChange').on('colorpickerChange', function() {
        setBrushColor();
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
    });

    $('#meme-canvas-wrapper').off('keyup').keyup(function (e) {
        keyMap[e.keyCode] = false;
    });

    // Scale is a range input allow small screen users to scale the object easily
    $('#scale').attr('max', canvas.width * 0.0025);
    $('#scale').val(canvas.width * 0.0025 / 2);

    resizeCanvas();

    // Add meme template as canvas background
    fabric.Image.fromURL(`${memeInfo.url}`, function (meme) {
        canvas.setBackgroundImage(meme, canvas.renderAll.bind(canvas));
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
    });

    // Event: Add new image
    $('#add-image').off('input').on('input', function () {
        const file = this.files[0];
        const fileType = file['type'];
        $('#add-image').val('');

        if (!isImage(fileType)) {
            showAlert('Error! Invalid Image');
            return;
        }

        const reader = new FileReader();
        reader.onload = function () {
            var image = new Image();
            image.src = reader.result;
            image.onload = function () {
                fabric.Image.fromURL(reader.result, function (image) {
                    image.scaleToWidth(canvas.width / 2);
                    canvas.add(image).setActiveObject(image);
                    $('#scale').val(image.scaleX);
                }, {
                    opacity: parseFloat($('#opacity').val()) / 100
                });
            }
        }
        reader.readAsDataURL(file);
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

    $('#generate-meme').off('click').on('click', function () {
        var dataURL = canvas.toDataURL({
            format: 'png',
        });

        var link = document.createElement('a');
        link.href = dataURL;
        link.download = createImgName();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}

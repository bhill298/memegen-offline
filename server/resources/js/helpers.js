// Update attribute of the current canvas object
var scheduleCanvasHistory = function () {};

function setValue(key, value) {
    if (canvas.getActiveObject() != null) {
        var activeText = canvas.getActiveObject();
        activeText.set(key, value);
        canvas.renderAll();
        scheduleCanvasHistory();
    }
}

// Return current background color
function getBackgroundColor(color) {
    if ($('#bg-option').hasClass('active')) {
        return color;
    } else {
        return '';
    }
}

function disableTextMethods(allowOpacity = false) {
    $('.text-method').attr('disabled', 'disabled');
    $('#font-family').selectpicker('refresh');
    $('.align').addClass('disabled');
    if (allowOpacity) {
        // ensure enabled
        $('#opacity').attr('disabled', false);
    }
    else {
        $('#opacity').attr('disabled', true);
    }
    $.each($('.cp'), function (i, cp) {
        let obj = $(cp).colorpicker('colorpicker');
        if (cp.id !== 'cp-brush') {
            obj.disable();
        }
        else {
            obj.enable();
        }
    });
}

function enableTextMethods() {
    $('.text-method').attr('disabled', false);
    $('#font-family').selectpicker('refresh');
    $('.align').removeClass('disabled');
    $('#opacity').attr('disabled', false);
    $.each($('.cp'), function (i, cp) {
        let obj = $(cp).colorpicker('colorpicker');
        if (cp.id !== 'cp-brush') {
            obj.enable();
        }
        else {
            obj.disable();
        }
    });
}

function createShadow(color, width) {
    return `${color} 0px 0px ${width}`;
}

function setBackgroundColor(color) {
    setValue("textBackgroundColor", getBackgroundColor(color));
}

function isImage(fileType) {
    const validImageTypes = [
        'image/jpeg', 'image/png', 'image/apng', 'image/gif', 'image/webp'
    ];
    if (validImageTypes.includes(fileType)) {
        return true;
    }
    return false;
}

const IMAGE_SIZE_LIMITS = Object.freeze({
    maxInputDimension: 16384,
    maxInputPixels: 100 * 1024 * 1024,
    maxOutputDimension: 8192,
    maxOutputPixels: 32 * 1024 * 1024,
    maxWorkingDimension: 2048,
    maxWorkingPixels: 4 * 1024 * 1024,
});

function fitImageDimensions(width, height, maxDimension, maxPixels) {
    const scale = Math.min(
        1,
        maxDimension / Math.max(width, height),
        Math.sqrt(maxPixels / (width * height))
    );
    return {
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale)),
    };
}

function greatestCommonDivisor(a, b) {
    while (b !== 0) {
        const remainder = a % b;
        a = b;
        b = remainder;
    }
    return a;
}

function fitWorkingDimensions(width, height) {
    const fitted = fitImageDimensions(
        width,
        height,
        IMAGE_SIZE_LIMITS.maxWorkingDimension,
        IMAGE_SIZE_LIMITS.maxWorkingPixels
    );
    if (fitted.width === width && fitted.height === height) {
        return fitted;
    }

    // Prefer an exact aspect ratio when a reasonably sized integer ratio exists.
    const divisor = greatestCommonDivisor(width, height);
    const ratioWidth = width / divisor;
    const ratioHeight = height / divisor;
    const factor = Math.floor(Math.min(
        IMAGE_SIZE_LIMITS.maxWorkingDimension / ratioWidth,
        IMAGE_SIZE_LIMITS.maxWorkingDimension / ratioHeight,
        Math.sqrt(IMAGE_SIZE_LIMITS.maxWorkingPixels / (ratioWidth * ratioHeight))
    ));
    if (factor >= 1) {
        return {
            width: ratioWidth * factor,
            height: ratioHeight * factor,
        };
    }
    return fitted;
}

function createImageSizePlan(width, height) {
    width = Number(width);
    height = Number(height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return { error: `Invalid image dimensions (${width} x ${height}).` };
    }

    width = Math.floor(width);
    height = Math.floor(height);
    if (Math.max(width, height) > IMAGE_SIZE_LIMITS.maxInputDimension ||
        width * height > IMAGE_SIZE_LIMITS.maxInputPixels) {
        return {
            error: `Image is too large (${width} x ${height}). The maximum input is ` +
                `${IMAGE_SIZE_LIMITS.maxInputDimension}px on either side and 100 megapixels.`
        };
    }

    const output = fitImageDimensions(
        width,
        height,
        IMAGE_SIZE_LIMITS.maxOutputDimension,
        IMAGE_SIZE_LIMITS.maxOutputPixels
    );
    const working = fitWorkingDimensions(output.width, output.height);
    const exportMultiplier = Math.min(
        output.width / working.width,
        output.height / working.height
    );

    return {
        sourceWidth: width,
        sourceHeight: height,
        outputWidth: Math.floor(working.width * exportMultiplier),
        outputHeight: Math.floor(working.height * exportMultiplier),
        workingWidth: working.width,
        workingHeight: working.height,
        exportMultiplier: exportMultiplier,
        outputWasReduced: output.width < width || output.height < height,
    };
}

// Generate a random 6-character name
function createImgName() {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < 6; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return `${result}.png`;
}

// Show alert message
function showAlert(message) {
    const $message = $('<strong></strong>').text(message);
    const $paragraph = $('<p></p>')
        .addClass('text-center mb-0')
        .append($message);
    $('.alert-container')
        .empty()
        .append($paragraph)
        .fadeIn('normal', function () {
            setTimeout(function () {
                $('.alert-container').fadeOut('normal', function () {
                    $('.alert-container').empty();
                });
            }, 3000);
        });
}

function reflowGrid() {
    let $grid = $('.grid').masonry({
        itemSelector: '.grid-item',
        percentPosition: true,
        columnWidth: '.grid-sizer',
        transitionDuration: 0
    });
    $grid.imagesLoaded().progress(function (instance, image) {
        if (image.isLoaded) {
            let img = image.img;
            img.setAttribute("img-height", img.naturalHeight);
            img.setAttribute("img-width", img.naturalWidth);
            $grid.masonry('layout');
        }
        else {
            showAlert(`Image ${image.img.src} failed to load`);
        }
    });
    return $grid;
}

var __searchTimeout = null;
function scheduleMemeSearch(searchBoxContents, timeout=500) {
    // timeout in ms
    if (__searchTimeout !== null) {
        clearTimeout(__searchTimeout);
    }
    __searchTimeout = setTimeout(function() {
        __searchTimeout = null;
        doMemeSearch(searchBoxContents);
    }, timeout);
}

var __lastMemeSearchTerm = "";
var __lastAndSelected = document.getElementById("meme-search-option-and").checked;
function doMemeSearch(searchBoxContents) {
    searchBoxContents = searchBoxContents.trim();
    // otherwise OR
    let andSelected = document.getElementById("meme-search-option-and").checked;
    if (searchBoxContents === __lastMemeSearchTerm && andSelected === __lastAndSelected) {
        // no need to do anything
        return;
    }
    __lastAndSelected = andSelected;
    __lastMemeSearchTerm = searchBoxContents;
    if (searchBoxContents.length === 0) {
        // reset
        loadPhotos(getCurrentMemeRange()[0]);
    }
    else {
        let names = [];
        let terms = searchBoxContents.toLowerCase().split(" ");
        let memeStride = getMemeStride();
        for (let name of getImages()) {
            if (names.length >= memeStride) {
                break;
            }
            let match = true;
            for (const term of terms) {
                // filter the image string to search on
                let imgStr = name.toLowerCase();
                // if it starts with a number (used for sorting), ignore it in the search
                let index = imgStr.indexOf("-");
                if (index !== -1 && !isNaN(imgStr.substr(0, index))) {
                    imgStr = imgStr.substr(index + 1);
                }
                if (term.length > 0 && imgStr.includes(term)) {
                    if (!andSelected) {
                        names.push(name);
                        break;
                    }
                }
                else if (andSelected) {
                    match = false;
                    break;
                }
            }
            if (andSelected && match) {
                names.push(name);
            }
        }
        updatePhotosFromNames(names);
    }
}

function initDropdown(num, callback) {
    let $sel = $("#page-dropdown");
    $sel.empty();
    for (let i = 0; i < num; i++) {
        let el = $("<option></option>").val(i).html(i);
        $sel.append(el);
    }
    $sel.selectpicker("refresh");
    $sel.selectpicker("val", 0);
    $sel.change(function() {
        callback($(this).val());
    });
    return $sel;
}

function setDropdown(val) {
    // clear search box
    $('#meme-search').val('');
    let $sel = $("#page-dropdown");
    $sel.selectpicker("val", val);
}

function canvasVisisble() {
    return document.getElementById("meme-canvas-wrapper").offsetParent !== null;
}

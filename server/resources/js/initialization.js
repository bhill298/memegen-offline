// Intialize color picker
$('#cp-text').colorpicker({
    fallbackColor: '#ffffff',
    input: '',
    useAlpha: false
});

// initialize this first to make sure it is rgba
$('#cp-brush').colorpicker({
    fallbackColor: '#000000ff',
    format: 'rgba',
    useAlpha: true
});

$('#cp-background').colorpicker({
    fallbackColor: '#000000ff',
    format: 'rgba',
    useAlpha: true
});

$('.cp-black').colorpicker({
    fallbackColor: '#000000',
    input: '',
    useAlpha: false
});

// Intialize font-family select
$('select').selectpicker({
    style: 'new-select',
});

loadPhotos(0);

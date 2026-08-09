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

$('.colorpicker-input-addon').on('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        $(this).trigger('click');
    }
});

// The animation selects are populated or updated at editor runtime and work
// best as native controls. Other selects retain the existing styled picker.
$('select:not(#animation-output-format):not(#animation-quality)').selectpicker({
    style: 'new-select',
});

loadPhotos(0);

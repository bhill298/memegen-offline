// Intialize color picker
$('#cp-text').colorpicker({
    fallbackColor: 'rgb(255, 255, 255)',
    input: '',
});

$('.cp-black').colorpicker({
    fallbackColor: '#000000',
    input: '',
})

// Intialize font-family select
$('select').selectpicker({
    style: 'new-select',
})

document.getElementById("meme-search").addEventListener("input", (e) => {
    let sel = $(".memes-container img");
    sel.hide();
    sel.filter(function() {return $(this).attr("alt").includes(e.target.value)}).show();
});

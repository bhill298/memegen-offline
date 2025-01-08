// go to https://www.17lands.com/card_ratings
// right click -> copy object
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadBinaryResource(url) {
    let response = await fetch(url);
    return await response.arrayBuffer();
}

function arrayBufferToBase64(arrayBuffer) {
    return btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
}

async function the_thing(arguments) {
    // arguments are an array of each arg from python (None -> null)
    const stage = arguments[0];
    let data = [];
    if (stage === 1) {
        // stage 1: get all the urls for the meme pages and titles
        let next_btn = document.getElementsByClassName("pager-next")[0]; 
        let next_url;
        if (next_btn.hasAttribute("disabled")) {
            next_url = null;
        }
        else {
            next_url = next_btn.href;
        }
        // the first entry is the continuation url, or null signaling to stop
        data.push(next_url);
        let max_iter = arguments[1];
        if (max_iter === null) {
            max_iter = Infinity
        }
        let i = 0;
        let els = document.getElementById("mt-boxes-wrap").getElementsByClassName("mt-box");
        while (i < max_iter && i < els.length) {
            let el = els[i];
            let title = el.getElementsByClassName("mt-title")[0].getElementsByTagName("a")[0].textContent;
            let template_url = el.getElementsByClassName("mt-img-wrap")[0].getElementsByTagName("a")[0].href.replace("/meme/", "/memetemplate/");
            // ignore gifs
            if (!template_url.toLowerCase().includes("/gif")) {
                data.push([title, template_url]);
            }
            i++;
        }
    }
    if (stage === 2) {
        // stage 2: go to each meme page and acquire the rest of the list of words and download the image
        // get the subtitle, extract the words after the ": ", split it into an array of each group separated by commas, extract each word into a separate array entry
        // some memes don't have a subtitle
        let also_called = [];
        let subtitle = document.getElementById("mtm-subtitle");
        if (subtitle !== null) {
            also_called = subtitle.textContent.split(": ")[1].split(", ").map(el => el.split(" ")).flat();
        }
        let filename = document.getElementById("mtm-img").src;
        let ext = "." + filename.split(".").pop();
        let img_base64 = arrayBufferToBase64(await loadBinaryResource(filename));
        data = [img_base64, also_called, ext];
    }
    return data;
}
return await the_thing(arguments);

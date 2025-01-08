<?php

$REL_PATH = 'img' . DIRECTORY_SEPARATOR . 'memes';

$path = realpath(dirname(__FILE__)) . DIRECTORY_SEPARATOR . $REL_PATH;
$files = array_diff(scandir($path), array('.', '..'));
header('Content-Type: application/json; charset=utf-8');
echo json_encode(array_values($files));

?>

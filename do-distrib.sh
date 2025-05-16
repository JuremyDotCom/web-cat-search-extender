DESC_LEN=$(cat manifest.json | jq .description | tr -d '"\n'  | wc -c)
if [ ${DESC_LEN} -gt 132 ]
then
  echo "Problem: Description length ${DESC_LEN} longer than Chromium max 132."
  exit -1
fi

rm dist/*.zip
zip -r -FS dist/webcatsearchext_ff.zip *.js *.md LICENSE icons manifest.json

pushd dist/
mkdir -p edge
cd edge
rm *.zip
cp ../webcatsearchext_ff.zip ./webcatsearchext_edge.zip
echo "Modding manifest for Edge"
cat ../../manifest.json | grep -v '"scripts".*background' > manifest.json
diff ../../manifest.json manifest.json
zip -r webcatsearchext_edge.zip manifest.json
popd

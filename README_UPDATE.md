# Update Summary

- Added `water_west_2_.csv` to the `FILES` array in `build-data.js` with directory `DATA_DIR2`.
- Ran `node build-data.js` to regenerate `data.js` with the new water temperature data.
- Generated `plot.html` containing a line chart of the water temperature data (downsampled to 2000 points for performance).

All existing data in `data.js` remains unchanged; the new data has been appended to the water temperature series for `westGH`.

To view the plot, open `plot.html` in a web browser.
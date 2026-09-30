# Medical 3D

更新：2026-09-30。狀態：第一版本機網頁已實作，使用固定版本 NiiVue 0.58.0。已驗證兩組 JPEG 三維示意堆疊、切片／四視窗、剖切與本機檔案匯入；準備發布 GitHub Pages 密碼解鎖版；尚未執行手術力學模擬。

目標：把 CT／MRI 轉為可在 Jason 的 M2 iPad Safari 操作的三維影像，逐步加入分割、剖切、路徑標記與教學模擬。平板確切尺寸及 iPadOS 版本待實機確認。重建與較重運算放 Mac，平板以瀏覽和互動為主；實測前不承諾幀率。

## 公開 skill 與引擎調查

| 候選 | 用途與評估 | 授權／查核 |
|---|---|---|
| [pieper/slicer-skill](https://github.com/pieper/slicer-skill) | 優先評估的 agent skill：Slicer Python、DICOM、分割、volume rendering；也附 Slicer MCP。skill 協助操作及開發，本身不是重建引擎。建議 web 模式起步。 | Apache-2.0；2026-09-17 更新，未封存。 |
| [jumbojing/slicerSkill](https://github.com/jumbojing/slicerSkill) | 以線上文件查詢為主的輕量替代；功能範圍偏開發參考。 | Apache-2.0；2026-02-24 更新，未封存。 |
| [zhaoyouj/mcp-slicer](https://github.com/zhaoyouj/mcp-slicer) | MCP 橋接，可列節點、執行 Python 與截圖；不是獨立平板應用。 | GitHub API 未辨識授權，採用前需人工核對；2026-08-05 更新。 |
| [ThalesMMS/dicom-skill](https://github.com/ThalesMMS/dicom-skill) | 偏 DICOM 傳輸與本機處理；不取代三維 viewer。其 DIMSE 流程不能直接套到現行 Safari/F5 醫院流程。 | Apache-2.0；2026-07-04 更新。 |
| [Kitware VolView](https://github.com/Kitware/VolView) | 現成瀏覽器 DICOM／三維 viewer，適合快速可行性試驗；M2 iPad Safari 手勢、記憶體及載入需實測。 | Apache-2.0；2026-09-30 更新。 |
| [NiiVue](https://github.com/niivue/niivue) | 適合客製平板介面，支援體積、mesh 與 WebGL2；DICOM 支援走插件，先轉 NIfTI 可簡化前端。 | BSD-2-Clause；2026-08-18 更新。官方正在遷移 niivue/mono，實作時須選定並鎖版本。 |
| [SlicerSOFA](https://github.com/Slicer/SlicerSOFA)／[SOFA](https://www.sofa-framework.org/) | 後續組織變形與互動力學模擬；需分割、網格、材料與邊界條件，不會只憑 MRI 自動得到可靠的手術模擬。 | SlicerSOFA MIT；SOFA LGPL；插件授權分別核對。 |

上列維護日期是查核時 GitHub pushed_at，並非品質或穩定性認證。已採用 NiiVue 0.58.0，來源與 npm 完整性校驗在 `evidence/niivue-dependency.json`；其他候選尚未安裝。

slicer-skill 上游 setup.sh 估計 full 約 15 GB、lightweight 約 1 GB、web 幾乎不需下載；這些是上游估計，非本機實測。實際脚本在 lightweight 也會取得 ProjectWeek，因此採用前應另算容量。它的 MCP 能任意執行 Slicer Python，不直接對平板或區網暴露這個控制端點。資料流：公開文件查詢只送公開關鍵字；病例處理沿用當次虛擬資料允許本機＋雲端的範圍，未知新來源重新判斷。

## 第一輪資料檢查

已檢查原報告目錄與搬移後的病例報告位置，並依 Jason 指定再檢查整個候選病例資料夾；檢查副檔名、檔案 magic、無副檔名候選及 ZIP／PPTX 內檔名。沒有找到可用的原始 MRI／CT 體積檔。現存資料是 PACS 顯示 JPEG／PNG 與播放影片。

已對 6 組影像擷取、共 462 張 JPEG 逐檔解析驗證並核對既有 SHA-256；全部吻合。這證明現存圖片完整，不能證明原始 MRI study 完整。擷取清單沒有每張切片的 ImagePositionPatient、ImageOrientationPatient、PixelSpacing；不能用影片幀數或檔名推定毫米尺度或原始序列身份。

個案影像與就緒性收據保存於 `Jason/Patients/<病歷號>/medical-3d/`，不複製到本程式專案。病例來源維持原位。其他報告候選以 PPTX／PDF／圖片為主，尚無已驗證的完整原始體積。

## 分階段實作與完成條件

1. **來源匯入與驗證**：取得一個日期的原始 3D MRI DICOM（或含 affine 的 NIfTI／NRRD）。依 Study/Series/SOP UID 分組、去重；檢查位置、方向、間距、缺片、局部定位圖、多時相／多 echo 及 enhanced multiframe。只通過某序列不等於整個 study 完整。MRI 優先選連續薄切 3D T1；序列名稱與清单張數只是候選線索，仍需檔案本身確認。
2. **平板瀏覽**：先驗證 VolView，或以 NiiVue 建客製介面。功能為軸／冠／矢三面、三維旋轉、雙指縮放、窗寬窗位與剖切；從 128³／256³ 預覽測試並保存原始解析度。驗收左右方向、比例、原片對位、初載時間、互動延遲、Safari 重載及橫直向操作。
3. **解剖分割與路徑示意**：Slicer 產生腦、病灶、血管等有來源支持的結構；人工核對 mask 後匯出 mesh。平板加入透明度、隱藏結構及入口／目標標記。CT 骨性結構與 MRI 的融合須另驗證配準。沒有經過幾何驗證前不顯示毫米測量或安全距離。
4. **力學模擬**：再接 SlicerSOFA／SOFA，先用合成幾何做可重現的碰撞、變形測試；切割與器械接觸另做驗證。影像外觀不能決定組織材料參數。研究與教學示範不等於已驗證的臨床導航。

目前阻礙：原始 DICOM／NIfTI 體積尚未找到。已用現有 JPEG 做未校準的三維視覺堆疊，並完成瀏覽介面測試；有解剖尺度的病例重建及手術模擬仍未開始。新資料到位後沿用病例目錄，不猜測缺失幾何。

執行規則：遵循 `/Volumes/EXTERNALSSD/FORGE/RULES.md`。重型轉檔、渲染與批次處理經已驗證有界入口；這個工作台的 generic Python runner 只適用它自己的有限輸入／標準庫契約，不能冒稱能跑整套醫學影像流程。新引擎先記錄版本、依賴、下載與暫存預算再執行。


## 第一版操作

建議以 GitHub 管理程式，以靜態網站提供介面；病例影像獨立保存。GitHub Pages 適合純前端 viewer，較重的分割／力學運算之後接 Mac 或專用服務。線上入口：https://jasonlu1006-blip.github.io/medical-3d/ 。main 保存程式，gh-pages 保存靜態頁面與加密示範包；不保存明文病例或密碼。

線上影像採 PBKDF2-SHA256（600,000 次）與 AES-256-GCM，帳密只在瀏覽器記憶體參與解密；重新整理／鎖定後重新解鎖。這是靜態檔案加密，不是伺服器帳號系統：無重試封鎖或撤銷已下載檔案能力；短密碼抵抗離線猜測能力有限。

啟動僅有合成幾何與本機檔案匯入的 viewer：

```sh
python3 -B code/serve.py
```

瀏覽 `http://127.0.0.1:8768`。加上 `--data-dir /absolute/path/to/selected-demo-directory` 可載入該目錄最多八個 `.m3d`。加 `--host 0.0.0.0` 供同一區網 iPad 使用；只在本次需要展示時開啟，結束以 Ctrl-C 停止，未設定常駐服務。Mac 必須開機，SSD 保持掛載；iPad 連同一 Wi-Fi，以 Mac 的區網 IP 和連接埠 8768 開啟。此本機展示服務無帳號驗證，僅提供選定資料，不應轉發至公網。

- `.m3d`：單一 JSON 影像包，內含原始 JPEG bytes；用「開啟影像檔」在瀏覽器載入，不會上傳到服務端。Mac 預設附兩組各 63 張影像包，位於病例的 `medical-3d/demo-v1/`，約 2.93／3.24 MiB。
- `.nii`：支援未壓縮、單一 3D、純量 NIfTI-1。64 MiB 檔案、每軸最多 512、總體素最多 256³。尚不接受 `.nii.gz` 或直接 DICOM。
- JPEG 由瀏覽器逐張解碼至 256×256，翻轉 raster Y 以保持原始平面顯示；無裁切、填補、分割或解剖方向推定。Z spacing 4 是**任意展示比例**，單位未知。所有視窗不顯示毫米尺規或左右方向標籤。
- 三維、單切片、四視窗可切換；控制亮度、不透明度及剖切深度。視角快捷鍵描述螢幕視角，沒有宣稱病人解剖方向。
- NiiVue 全部從 `web/vendor` 本機載入，沒有 CDN runtime 依賴；CSP 只准同源連線。後端不接受上傳、不列資料夾，只提供固定靜態資產、目錄清單及明確選定的影像包。
- `.gitignore` 排除病例檔、影像、派生資料與本機契約。發布前仍核對實際 Git 清單；不要把病例資料複製進 repository。

## 驗證

`code/test_integrity.py` 檢查封裝保存原始 bytes、缺片／重號／hash mismatch／越界路徑拒絕，以及 server 資產邊界。經 safe_run 執行 7 項通過。兩次真實來源封裝亦經 safe_run，實際程序 exit 0、子程序群組已結束、輸出 SHA-256 與複製後一致。轉檔工作讀取指定病例範圍，沒有新增醫院登入。

瀏覽器已實際查看合成體積、兩個日期 MRI、三維／切片／四視窗、剖切，並測試 `.m3d`／合成 `.nii` 本機選檔及壞檔拒絕。檢查 1180×820 與 820×1180 平板尺寸；這是桌面瀏覽器 viewport 驗證，**不是 M2 iPad 實機 Safari／觸控／幀率驗收**。病例畫面與來源證據在病例資料夾，通用技術收據在 `evidence/validation.json`。

第一版沒有分割、配準、路徑標記、切割、變形或臨床導航。JPEG 體積邊緣雜訊與幾何比例限制保留在介面中，不能把此展示當作精確 MRI 重建。

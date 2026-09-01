# -*- coding: utf-8 -*-
"""Copy Resources/Art into ASCII characters/ paths the engine always finds."""
from pathlib import Path
import shutil
import json

ROOT = Path(r"e:\Workspace\cursorWokspace\Visual-novel")
ART = ROOT / "Resources" / "Art"

COPIES = [
    # ringo normal glasses
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_01_default_confident.png", "characters/ringo/neutral.png"),
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_02_hearty_laugh.png", "characters/ringo/smile.png"),
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_02_hearty_laugh.png", "characters/ringo/laugh.png"),
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_03_awkward_teasing.png", "characters/ringo/teasing.png"),
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_03_awkward_teasing.png", "characters/ringo/forced_smile.png"),
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_04_dead_serious.png", "characters/ringo/serious.png"),
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_04_dead_serious.png", "characters/ringo/resolute.png"),
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_05_gentle.png", "characters/ringo/gentle.png"),
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_05_gentle.png", "characters/ringo/calm.png"),
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_06_weary_sad.png", "characters/ringo/sad.png"),
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_06_weary_sad.png", "characters/ringo/guilty.png"),
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_07_mischievous_awkward.png", "characters/ringo/mischievous.png"),
    ("角色立绘/林檎/林檎 正常/ringo_normal_glasses_01_default_confident.png", "characters/ringo/base.png"),
    # ringo protect
    ("角色立绘/林檎/林檎 抬手指挥保护/林檎 抬手指挥保护 有眼镜 01 坚定领导.png", "characters/ringo/protect_resolute.png"),
    ("角色立绘/林檎/林檎 抬手指挥保护/林檎 抬手指挥保护 有眼镜 01 坚定领导.png", "characters/ringo/protect_neutral.png"),
    ("角色立绘/林檎/林檎 抬手指挥保护/林檎 抬手指挥保护 有眼镜 02 震惊恐惧惊愕吐槽.png", "characters/ringo/protect_surprised.png"),
    ("角色立绘/林檎/林檎 抬手指挥保护/林檎 抬手指挥保护 有眼镜 02 震惊恐惧惊愕吐槽.png", "characters/ringo/protect_guilty.png"),
    ("角色立绘/林檎/林檎 抬手指挥保护/林檎 抬手指挥保护 有眼镜 03 达观自信.png", "characters/ringo/protect_smile.png"),
    # xian normal
    ("角色立绘/闲/闲 正常/闲 正常 01 默认.png", "characters/xian/neutral.png"),
    ("角色立绘/闲/闲 正常/闲 正常 02 凑合的微笑.png", "characters/xian/smile.png"),
    ("角色立绘/闲/闲 正常/闲 正常 02 凑合的微笑.png", "characters/xian/hopeful.png"),
    ("角色立绘/闲/闲 正常/闲 正常 03 轻微的惊讶.png", "characters/xian/surprised.png"),
    ("角色立绘/闲/闲 正常/闲 正常 04 认真思索小尴尬.png", "characters/xian/thinking.png"),
    ("角色立绘/闲/闲 正常/闲 正常 04 认真思索小尴尬.png", "characters/xian/determined.png"),
    ("角色立绘/闲/闲 正常/闲 正常 05 悲观呆滞.png", "characters/xian/numb.png"),
    ("角色立绘/闲/闲 正常/闲 正常 05 悲观呆滞.png", "characters/xian/pained.png"),
    ("角色立绘/闲/闲 正常/闲 正常 01 默认.png", "characters/xian/base.png"),
    # xian injured
    ("角色立绘/闲/闲 受伤/闲 受伤 01 硬撑.png", "characters/xian/injured_neutral.png"),
    ("角色立绘/闲/闲 受伤/闲 受伤 02 疼痛难忍.png", "characters/xian/injured_pained.png"),
    ("角色立绘/闲/闲 受伤/闲 受伤 03 神情恍惚.png", "characters/xian/injured_numb.png"),
    ("角色立绘/闲/闲 受伤/闲 受伤 04 放松无意识.png", "characters/xian/injured_unconscious.png"),
    ("角色立绘/闲/闲 受伤/闲 受伤 01 硬撑.png", "characters/xian/injured.png"),
    # xian bedridden
    ("角色立绘/闲/闲 受伤卧床/闲_卧床_相机_03_默认.png", "characters/xian/bedridden_neutral.png"),
    ("角色立绘/闲/闲 受伤卧床/闲_卧床_相机_01_由衷微笑.png", "characters/xian/bedridden_smile.png"),
    ("角色立绘/闲/闲 受伤卧床/闲_卧床_相机_03_默认.png", "characters/xian/bedridden.png"),
    # miles
    ("角色立绘/迈尔斯/迈尔斯 正常/miles_normal_pack_01_default.png", "characters/miles/neutral.png"),
    ("角色立绘/迈尔斯/迈尔斯 正常/miles_normal_pack_02_drowsy.png", "characters/miles/tired.png"),
    ("角色立绘/迈尔斯/迈尔斯 正常/miles_normal_pack_02_drowsy.png", "characters/miles/drowsy.png"),
    ("角色立绘/迈尔斯/迈尔斯 正常/miles_normal_pack_03_wry_smile.png", "characters/miles/smile.png"),
    ("角色立绘/迈尔斯/迈尔斯 正常/miles_normal_pack_03_wry_smile.png", "characters/miles/gentle.png"),
    ("角色立绘/迈尔斯/迈尔斯 正常/miles_normal_pack_03_wry_smile.png", "characters/miles/hopeful.png"),
    ("角色立绘/迈尔斯/迈尔斯 正常/miles_normal_pack_04_startled_serious.png", "characters/miles/serious.png"),
    ("角色立绘/迈尔斯/迈尔斯 正常/miles_normal_pack_04_startled_serious.png", "characters/miles/stubborn.png"),
    ("角色立绘/迈尔斯/迈尔斯 正常/miles_normal_pack_01_default.png", "characters/miles/base.png"),
    ("角色立绘/迈尔斯/迈尔斯 手指路/miles_point_pack_03_shock_fear.png", "characters/miles/fear.png"),
    ("角色立绘/迈尔斯/迈尔斯 检查物资/miles_inventory_03_worried.png", "characters/miles/worried.png"),
    # teacher
    ("npc立绘/老师/teacher_01_default.png", "characters/teacher/neutral.png"),
    ("npc立绘/老师/teacher_01_default.png", "characters/teacher/silhouette.png"),
    ("npc立绘/老师/teacher_02_ai_default.png", "characters/teacher/ai.png"),
    ("npc立绘/老师/teacher_03_ai_preaching.png", "characters/teacher/preaching.png"),
    ("npc立绘/老师/teacher_04_mild_surprise.png", "characters/teacher/surprised.png"),
    ("npc立绘/老师/teacher_05_smile.png", "characters/teacher/smile.png"),
    ("npc立绘/老师/teacher_01_default.png", "characters/teacher/base.png"),
    # npcs
    ("npc立绘/枪击npc1/shooter_01_threatening.png", "characters/shooter/threatening.png"),
    ("npc立绘/枪击npc1/shooter_01_threatening.png", "characters/shooter/neutral.png"),
    ("npc立绘/枪击npc1/shooter_02_wavering.png", "characters/shooter/wavering.png"),
    ("npc立绘/枪击npc1/shooter_03_breaking_down.png", "characters/shooter/breaking.png"),
    ("npc立绘/枪击npc1/shooter_04_after_the_shot.png", "characters/shooter/after_shot.png"),
    ("npc立绘/枪击npc1/shooter_01_threatening.png", "characters/shooter/base.png"),
    ("npc立绘/枪击npc2/bystander_01_default.png", "characters/bystander/neutral.png"),
    ("npc立绘/枪击npc2/bystander_02_angry_failed.png", "characters/bystander/angry.png"),
    ("npc立绘/枪击npc2/bystander_01_default.png", "characters/bystander/base.png"),
    ("npc立绘/枪击npc3.png", "characters/gunshot_npc3/neutral.png"),
    ("npc立绘/枪击npc3.png", "characters/gunshot_npc3/base.png"),
    ("npc立绘/医院占领着/hospital_occupier_02_default.png", "characters/hospital_occupier/neutral.png"),
    ("npc立绘/医院占领着/hospital_occupier_01_confident_smile.png", "characters/hospital_occupier/smile.png"),
    ("npc立绘/医院占领着/hospital_occupier_03_angry.png", "characters/hospital_occupier/angry.png"),
    ("npc立绘/医院占领着/hospital_occupier_02_default.png", "characters/hospital_occupier/base.png"),
    ("npc立绘/穿着大人衣服的小孩/kid_adultclothes_02_calm.png", "characters/kid_adultclothes/neutral.png"),
    ("npc立绘/穿着大人衣服的小孩/kid_adultclothes_02_calm.png", "characters/kid_adultclothes/calm.png"),
    ("npc立绘/穿着大人衣服的小孩/kid_adultclothes_01_pretending.png", "characters/kid_adultclothes/pretending.png"),
    ("npc立绘/穿着大人衣服的小孩/kid_adultclothes_03_flustered.png", "characters/kid_adultclothes/flustered.png"),
    ("npc立绘/穿着大人衣服的小孩/kid_adultclothes_04_grief.png", "characters/kid_adultclothes/grief.png"),
    ("npc立绘/穿着大人衣服的小孩/kid_adultclothes_02_calm.png", "characters/kid_adultclothes/base.png"),
    ("npc立绘/视觉系哥们/npc_leader_01_confident.png", "characters/visualkei_leader/neutral.png"),
    ("npc立绘/视觉系哥们/npc_leader_01_confident.png", "characters/visualkei_leader/confident.png"),
    ("npc立绘/视觉系哥们/npc_leader_02_mild_surprise.png", "characters/visualkei_leader/surprised.png"),
    ("npc立绘/视觉系哥们/npc_leader_03_smile_gone.png", "characters/visualkei_leader/smile_gone.png"),
    ("npc立绘/视觉系哥们/npc_leader_04_rage.png", "characters/visualkei_leader/rage.png"),
    ("npc立绘/视觉系哥们/npc_leader_05_shaken.png", "characters/visualkei_leader/shaken.png"),
    ("npc立绘/视觉系哥们/npc_leader_01_confident.png", "characters/visualkei_leader/base.png"),
    ("npc立绘/拦路虎npc.png", "characters/roadblock/neutral.png"),
    ("npc立绘/拦路虎npc.png", "characters/roadblock/base.png"),
    ("npc立绘/修车少年npc.png", "characters/mechanic_boy/neutral.png"),
    ("npc立绘/修车少年npc.png", "characters/mechanic_boy/base.png"),
    ("npc立绘/电波教团/radiocult_01_boombox_head.png", "characters/radiocult/neutral.png"),
    ("npc立绘/电波教团/radiocult_01_boombox_head.png", "characters/radiocult/boombox.png"),
    ("npc立绘/电波教团/radiocult_02_headphones_mask.png", "characters/radiocult/headphones.png"),
    ("npc立绘/电波教团/radiocult_03_tinfoil_hat.png", "characters/radiocult/tinfoil.png"),
    ("npc立绘/电波教团/radiocult_04_pot_head.png", "characters/radiocult/pot.png"),
    ("npc立绘/电波教团/radiocult_01_boombox_head.png", "characters/radiocult/base.png"),
    ("npc立绘/野狗/wilddog_01_single.png", "characters/wilddog/neutral.png"),
    ("npc立绘/野狗/wilddog_01_single.png", "characters/wilddog/single.png"),
    ("npc立绘/野狗/wilddog_02_pack.png", "characters/wilddog/pack.png"),
    ("npc立绘/野狗/wilddog_01_single.png", "characters/wilddog/base.png"),
]

ok = 0
missing = []
for src_rel, dst_rel in COPIES:
    src = ART / src_rel
    dst = ROOT / dst_rel
    if not src.exists():
        missing.append(str(src_rel))
        continue
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    ok += 1

print(f"copied {ok}/{len(COPIES)}")
if missing:
    print("MISSING", len(missing))
    for m in missing[:20]:
        print(" ", m)

from PIL import Image
import os

os.makedirs("shots/crops", exist_ok=True)

def crop(src, box, out, scale=3):
    im = Image.open(src)
    c = im.crop(box)
    w,h = c.size
    c = c.resize((w*scale, h*scale), Image.NEAREST)
    c.save(out)
    print(out, c.size)

# brute in wedge
crop("shots/p4v24_battle_wedge.png", (1120,150,1345,340), "shots/crops/brute_wedge.png")
# brute in clash
crop("shots/p4v24_battle_clash.png", (870,150,1030,300), "shots/crops/brute_clash.png")
# weapon glyphs closeup - units in wedge left cluster (defenders)
crop("shots/p4v24_battle_wedge.png", (440,230,780,400), "shots/crops/defenders_wedge.png")
# enemy units close up in wedge right side
crop("shots/p4v24_battle_wedge.png", (890,180,1270,420), "shots/crops/enemies_wedge.png")
# clash scene full HP bar region
crop("shots/p4v24_battle_clash.png", (780,60,1000,400), "shots/crops/clash_hpbars.png", scale=2)
# odds pill favored in world
crop("shots/p4v24_world.png", (690,205,800,290), "shots/crops/favored_pill.png", scale=5)
# bridge scene weapon glyphs
crop("shots/p4v24_battle_bridge.png", (380,190,650,400), "shots/crops/bridge_weapons.png")
